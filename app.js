// Atividade Educativa UNASP — Plataforma de Registro de Presença
// Toda a segurança fica no banco (RLS + funções). Esta chave é pública por design.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://rikfolktwyaqkuehalqc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpa2ZvbGt0d3lhcWt1ZWhhbHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMjkyNDIsImV4cCI6MjEwNjkwNTI0Mn0.n5CsL4JvxE4_wEzX_HDWNZW7ck2fRw7RVKFjxFV2lHo';
const RA_DOMINIO = 'aluno.te-unasp.app';
const INATIVIDADE_MIN = 30; // sai sozinho após 30 min parado

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
const $app = document.getElementById('app');
const S = { perfil: null, setores: [], planos: [], view: null, setorAtivo: null };

// ---------- utilidades ----------
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h1 = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const sinal = n => { n = Number(n) || 0; return `<span class="${n < -0.05 ? 'neg' : n > 0.05 ? 'pos' : ''}">${n > 0 ? '+' : ''}${h1(n)}h</span>`; };
const hora = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dataHora = ts => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function toast(msg, bad) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500);
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) { toast(error.message, true); throw error; }
  return data;
}
const nomeSetor = id => {
  const s = S.setores.find(x => x.id === id); if (!s) return '—';
  const pai = s.setor_pai_id && S.setores.find(x => x.id === s.setor_pai_id);
  return pai ? `${pai.nome} › ${s.nome}` : s.nome;
};
const setoresOrdenados = () => {
  const raiz = S.setores.filter(s => !s.setor_pai_id).sort((a, b) => a.nome.localeCompare(b.nome));
  const out = [];
  raiz.forEach(r => { out.push(r); S.setores.filter(s => s.setor_pai_id === r.id).sort((a, b) => a.nome.localeCompare(b.nome)).forEach(f => out.push(f)); });
  return out;
};
const optsSetor = (sel, vazio) => (vazio ? `<option value="">${vazio}</option>` : '') +
  setoresOrdenados().map(s => `<option value="${s.id}" ${s.id == sel ? 'selected' : ''}>${esc(nomeSetor(s.id))}</option>`).join('');

// ---------- sessão ----------
let inativo;
function vigiarInatividade() {
  const reset = () => { clearTimeout(inativo); inativo = setTimeout(() => sair('Sessão encerrada por inatividade.'), INATIVIDADE_MIN * 60000); };
  ['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, reset, { passive: true }));
  reset();
}
async function sair(msg) { await sb.auth.signOut(); S.perfil = null; telaLogin(msg); }

async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return telaLogin();
  const perfil = (await q(sb.from('perfis').select('*').eq('user_id', session.user.id)))[0];
  if (!perfil || !perfil.ativo) { await sb.auth.signOut(); return telaLogin('Esta conta não tem acesso à plataforma.'); }
  S.perfil = perfil;
  [S.setores, S.planos] = await Promise.all([
    q(sb.from('setores').select('*').order('nome')),
    q(sb.from('planos').select('*').order('codigo')),
  ]);
  vigiarInatividade();
  if (perfil.papel === 'naf') return ir('painel');
  if (perfil.papel === 'lider') return ir('ponto');
  return ir('meu');
}

function telaLogin(msg = '') {
  $app.innerHTML = `
  <div class="center"><form class="login" id="f">
    <div class="logo">AE</div>
    <h1>Atividade Educativa</h1>
    <div class="muted small">UNASP · Controle de horas</div>
    <label for="u">RA ou e-mail</label><input id="u" autocomplete="username" required>
    <label for="p">Senha</label><input id="p" type="password" autocomplete="current-password" required>
    <button class="btn primary block" id="b">Entrar</button>
    <div class="err" id="e">${esc(msg)}</div>
    <div class="muted small" style="margin-top:8px">Esqueceu a senha? Procure o NAF.</div>
  </form></div>`;
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault();
    const u = document.getElementById('u').value.trim().toLowerCase();
    const email = u.includes('@') ? u : `ra-${u.replace(/\D/g, '')}@${RA_DOMINIO}`;
    const b = document.getElementById('b'); b.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: document.getElementById('p').value });
    b.disabled = false;
    if (error) { document.getElementById('e').textContent = 'RA/e-mail ou senha incorretos.'; return; }
    iniciar();
  };
}

// ---------- casca ----------
const MENUS = {
  naf: [['painel', 'Painel'], ['alunos', 'Alunos'], ['ponto', 'Registrar presença'], ['setores', 'Setores']],
  lider: [['ponto', 'Registrar presença'], ['alunos', 'Meus alunos']],
  aluno: [['meu', 'Meu saldo']],
};
function casca(conteudo) {
  const p = S.perfil;
  $app.innerHTML = `
  <header class="top">
    <div class="name">AE · UNASP</div>
    <nav>${MENUS[p.papel].map(([k, t]) => `<a href="#" data-v="${k}" class="${S.view === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <div class="who"><span>${esc(p.nome)} · ${p.papel.toUpperCase()}</span><button id="sair">Sair</button></div>
  </header><main id="main">${conteudo}</main>`;
  $app.querySelectorAll('nav a').forEach(a => a.onclick = e => { e.preventDefault(); ir(a.dataset.v); });
  document.getElementById('sair').onclick = () => sair();
}
const VIEWS = {};
async function ir(v) { S.view = v; casca('<div class="muted">Carregando…</div>'); try { await VIEWS[v](); } catch (e) { console.error(e); } }

// ---------- NAF: painel ----------
VIEWS.painel = async () => {
  const [saldos, pend] = await Promise.all([
    q(sb.from('v_saldos').select('*')),
    q(sb.from('pendencias').select('*').eq('resolvida', false).order('tipo').order('ra')),
  ]);
  const devendo = saldos.filter(s => s.saldo_mes < -0.05).sort((a, b) => a.saldo_mes - b.saldo_mes);
  const sobrando = saldos.filter(s => s.saldo_mes > 0.05).sort((a, b) => b.saldo_mes - a.saldo_mes);
  const devAnt = saldos.filter(s => s.saldo_mes_ant < -0.05);
  const tipos = { ra_duplicado: ['RA duplicado', 'bad'], horas_diferentes: ['Horas ≠ plano', 'warn'], sem_plano: ['Sem plano', 'warn'], outro: ['Outro', ''] };
  const linha = s => `<tr class="click" data-a="${s.aluno_id}"><td>${esc(s.nome)}<div class="muted small">${esc(s.ra)}</div></td><td class="hide-m">${esc(nomeSetor(s.setor_id))}</td><td class="num">${sinal(s.saldo_mes)}</td></tr>`;
  document.getElementById('main').innerHTML = `
  <div class="grid kpis">
    <div class="kpi"><div class="muted small">Bolsistas ativos</div><div class="v">${saldos.length}</div></div>
    <div class="kpi bad"><div class="muted small">Com horas pendentes este mês</div><div class="v">${devendo.length}</div></div>
    <div class="kpi ok"><div class="muted small">Com horas sobrando</div><div class="v">${sobrando.length}</div></div>
    <div class="kpi warn"><div class="muted small">Pendências a resolver</div><div class="v">${pend.length}</div></div>
  </div>
  ${pend.length ? `<div class="card" style="margin-top:16px"><div class="row"><h2 class="grow">⚠️ Pendências a resolver</h2>
      <select id="fp" style="width:auto"><option value="">Todas (${pend.length})</option>${Object.entries(tipos).map(([k, [t]]) => { const n = pend.filter(p => p.tipo === k).length; return n ? `<option value="${k}">${t} (${n})</option>` : ''; }).join('')}</select></div>
    <div id="lp"></div></div>` : ''}
  <div class="split" style="margin-top:16px">
    <div class="card"><h2>Mais horas pendentes (mês atual)</h2><div class="scroll"><table><tbody>${devendo.slice(0, 15).map(linha).join('') || '<tr><td class="muted">Ninguém com horas pendentes.</td></tr>'}</tbody></table></div>
      ${devAnt.length ? `<div class="muted small" style="margin-top:8px">${devAnt.length} aluno(s) fecharam o mês passado com horas pendentes.</div>` : ''}</div>
    <div class="card"><h2>Mais horas sobrando</h2><div class="scroll"><table><tbody>${sobrando.slice(0, 15).map(linha).join('') || '<tr><td class="muted">Nenhum ainda.</td></tr>'}</tbody></table></div></div>
  </div>`;
  const renderPend = filtro => {
    const lp = document.getElementById('lp'); if (!lp) return;
    lp.innerHTML = pend.filter(p => !filtro || p.tipo === filtro).map(p => `
      <div class="pend"><span class="tag ${tipos[p.tipo][1]}">${tipos[p.tipo][0]}</span>
        <div class="grow"><div>${esc(p.descricao)}</div>
          <div class="muted small">RA ${esc(p.ra)}${p.dados && Array.isArray(p.dados) ? ' · ' + p.dados.map(d => esc(d.nome) + ' (' + esc(d.setor) + ')').join(' · ') : ''}</div></div>
        <div class="row">${p.aluno_id ? `<button class="btn sm" data-a="${p.aluno_id}">Abrir aluno</button>` : ''}<button class="btn sm primary" data-r="${p.id}">Resolver</button></div>
      </div>`).join('');
    lp.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
      const r = prompt('Como foi resolvido? (fica registrado)'); if (!r) return;
      await q(sb.rpc('resolver_pendencia', { p_id: +b.dataset.r, p_resolucao: r }));
      toast('Pendência resolvida.'); ir('painel');
    });
    lp.querySelectorAll('[data-a]').forEach(b => b.onclick = () => abrirAluno(b.dataset.a));
  };
  renderPend('');
  const fp = document.getElementById('fp'); if (fp) fp.onchange = () => renderPend(fp.value);
  document.querySelectorAll('tr[data-a]').forEach(tr => tr.onclick = () => abrirAluno(tr.dataset.a));
};

// ---------- Alunos (NAF vê todos; líder vê o setor) ----------
VIEWS.alunos = async () => {
  const saldos = await q(sb.from('v_saldos').select('*').order('nome'));
  const naf = S.perfil.papel === 'naf';
  document.getElementById('main').innerHTML = `
  <div class="card">
    <div class="row"><h2 class="grow">Alunos</h2>${naf ? '<button class="btn primary" id="novo">+ Novo aluno</button>' : ''}</div>
    <div class="row" style="margin-top:8px">
      <input class="grow" id="busca" placeholder="Buscar por nome ou RA">
      <select id="fs" style="width:auto;max-width:260px">${optsSetor('', 'Todos os setores')}</select>
      <select id="fsal" style="width:auto"><option value="">Todos</option><option value="dev">Com horas pendentes</option><option value="sob">Com horas sobrando</option></select>
      ${naf ? '<button class="btn" id="csv">Exportar</button>' : ''}
    </div>
    <div class="scroll" style="margin-top:12px"><table><thead><tr><th>Aluno</th><th class="hide-m">Setor</th><th class="hide-m">Plano</th><th class="num">Previsto</th><th class="num">Cumpridas</th><th class="num">Saldo mês</th><th class="num hide-m">Mês passado</th></tr></thead><tbody id="tb"></tbody></table></div>
    <div class="muted small" id="cont" style="margin-top:8px"></div>
  </div>`;
  const filtrar = () => {
    const t = document.getElementById('busca').value.toLowerCase().trim();
    const fs = document.getElementById('fs').value; const fsal = document.getElementById('fsal').value;
    const filhos = fs ? [+fs, ...S.setores.filter(s => s.setor_pai_id == fs).map(s => s.id)] : null;
    const l = saldos.filter(s => (!t || s.nome.toLowerCase().includes(t) || s.ra.includes(t)) && (!filhos || filhos.includes(s.setor_id)) &&
      (!fsal || (fsal === 'dev' ? s.saldo_mes < -0.05 : s.saldo_mes > 0.05)));
    document.getElementById('tb').innerHTML = l.slice(0, 400).map(s => `
      <tr class="click" data-a="${s.aluno_id}"><td>${esc(s.nome)}<div class="muted small">${esc(s.ra)}</div></td>
      <td class="hide-m">${esc(nomeSetor(s.setor_id))}</td><td class="hide-m">${esc(s.plano || '—')} <span class="muted small">${h1(s.horas_semana)}h/sem</span></td>
      <td class="num">${h1(s.meta_mes)}h</td><td class="num">${h1(s.feitas_mes)}h</td><td class="num">${sinal(s.saldo_mes)}</td><td class="num hide-m">${sinal(s.saldo_mes_ant)}</td></tr>`).join('');
    document.getElementById('cont').textContent = `${l.length} aluno(s)` + (l.length > 400 ? ' — mostrando 400, refine a busca' : '');
    document.querySelectorAll('#tb tr').forEach(tr => tr.onclick = () => abrirAluno(tr.dataset.a));
    S._lista = l;
  };
  ['busca', 'fs', 'fsal'].forEach(id => document.getElementById(id).oninput = filtrar);
  filtrar();
  if (naf) {
    document.getElementById('novo').onclick = () => abrirAluno(null);
    document.getElementById('csv').onclick = () => {
      const cols = ['ra', 'nome', 'setor', 'plano', 'horas_semana', 'meta_mes', 'feitas_mes', 'saldo_mes', 'saldo_mes_ant'];
      const csv = [cols.join(';'), ...S._lista.map(s => cols.map(c => String(c === 'setor' ? nomeSetor(s.setor_id) : s[c] ?? '').replace(/;/g, ',')).join(';'))].join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
      a.download = `saldos-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    };
  }
};

// ---------- Ficha do aluno (drawer) ----------
async function abrirAluno(id) {
  const naf = S.perfil.papel === 'naf';
  const a = id ? (await q(sb.from('alunos').select('id,ra,nome,nascimento,telefone,curso,semestre,plano,setor_id,plantao_setor_id,horas_semana,observacao,ativo').eq('id', id)))[0]
    : { ativo: true };
  if (!a) return toast('Aluno não encontrado.', true);
  const [regs, pend, trans] = id ? await Promise.all([
    q(sb.from('registros').select('*').eq('aluno_id', id).order('ts', { ascending: false }).limit(30)),
    naf ? q(sb.from('pendencias').select('*').eq('aluno_id', id).eq('resolvida', false)) : [],
    q(sb.from('transferencias').select('*').eq('aluno_id', id).order('em', { ascending: false }).limit(5)),
  ]) : [[], [], []];
  const dis = naf ? '' : 'disabled';
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="drawer">
    <button class="btn sm close" id="x">Fechar</button>
    <h2>${id ? esc(a.nome) : 'Novo aluno'}</h2>
    ${id ? `<div class="muted small">RA ${esc(a.ra)} · ${esc(nomeSetor(a.setor_id))} ${a.ativo ? '' : '<span class="tag bad">inativo</span>'}</div>` : ''}
    ${pend.map(p => `<div class="tag warn" style="margin-top:8px;display:block;white-space:normal">⚠️ ${esc(p.descricao)}</div>`).join('')}
    <form id="fa"><div class="fields">
      <div class="full"><label>Nome</label><input name="nome" value="${esc(a.nome)}" required ${dis}></div>
      <div><label>RA</label><input name="ra" value="${esc(a.ra)}" required ${dis} inputmode="numeric"></div>
      <div><label>Nascimento</label><input name="nascimento" type="date" value="${esc(a.nascimento)}" ${dis}></div>
      <div><label>Telefone</label><input name="telefone" value="${esc(a.telefone)}" ${dis}></div>
      <div><label>Semestre</label><input name="semestre" value="${esc(a.semestre)}" ${dis}></div>
      <div class="full"><label>Curso</label><input name="curso" value="${esc(a.curso)}" ${dis}></div>
      <div><label>Plano</label><select name="plano" ${dis}><option value="">—</option>${S.planos.map(p => `<option value="${p.codigo}" ${p.codigo === a.plano ? 'selected' : ''}>${p.codigo} · ${h1(p.horas_semana)}h/sem</option>`).join('')}</select></div>
      <div><label>Horas/semana individuais</label><input name="horas_semana" type="number" step="0.5" min="0" value="${esc(a.horas_semana)}" placeholder="usar do plano" ${dis}></div>
      ${id ? '' : `<div class="full"><label>Setor</label><select name="setor_id" required>${optsSetor(a.setor_id, 'Escolha…')}</select></div>`}
      <div class="full"><label>Plantão</label><select name="plantao_setor_id" ${dis}>${optsSetor(a.plantao_setor_id, 'Nenhum')}</select></div>
      <div class="full"><label>Observação</label><textarea name="observacao" rows="2" ${dis}>${esc(a.observacao)}</textarea></div>
      ${naf ? `<div class="full"><label><input type="checkbox" name="ativo" style="width:auto" ${a.ativo ? 'checked' : ''}> Ativo</label></div>` : ''}
    </div>${naf ? '<button class="btn primary block">Salvar</button>' : ''}</form>
    ${id && naf ? `<hr><h3>Transferir de setor</h3>
      <div class="row"><select id="tps" class="grow">${optsSetor('', 'Novo setor…')}</select><button class="btn" id="tbt">Transferir</button></div>
      <input id="tmo" placeholder="Motivo (opcional)" style="margin-top:8px">
      ${trans.length ? `<div class="muted small" style="margin-top:8px">${trans.map(t => `${dataHora(t.em)}: ${esc(nomeSetor(t.de_setor))} → ${esc(nomeSetor(t.para_setor))}`).join('<br>')}</div>` : ''}
      <hr><h3>PIN do quiosque</h3><div class="row"><input id="pin" class="grow" inputmode="numeric" maxlength="6" placeholder="4 a 6 números"><button class="btn" id="pbt">Definir PIN</button></div>` : ''}
    ${id ? `<hr><h3>Últimos registros</h3>${regs.length ? `<table><tbody>${regs.map(r => `<tr><td>${dataHora(r.ts)}</td><td>${r.tipo === 'entrada' ? '▶ Entrada' : '■ Saída'}</td><td class="muted small">${esc(r.origem)}</td><td>${r.cancelado ? '<span class="tag bad">cancelado</span>' : `<button class="btn sm" data-c="${r.id}">Cancelar</button>`}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Nenhum registro.</div>'}` : ''}
  </div>`;
  document.body.appendChild(ov);
  const fechar = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) fechar(); };
  ov.querySelector('#x').onclick = fechar;
  ov.querySelector('#fa').onsubmit = async e => {
    e.preventDefault(); if (!naf) return;
    const f = new FormData(e.target); const d = Object.fromEntries(f.entries());
    const row = { nome: d.nome.trim(), ra: d.ra.trim(), nascimento: d.nascimento || null, telefone: d.telefone || null, semestre: d.semestre || null,
      curso: d.curso || null, plano: d.plano || null, horas_semana: d.horas_semana === '' ? null : +d.horas_semana,
      plantao_setor_id: d.plantao_setor_id ? +d.plantao_setor_id : null, observacao: d.observacao || null, ativo: f.has('ativo') };
    if (id) await q(sb.from('alunos').update(row).eq('id', id));
    else await q(sb.from('alunos').insert({ ...row, setor_id: +d.setor_id }));
    toast('Aluno salvo.'); fechar(); ir(S.view);
  };
  const tbt = ov.querySelector('#tbt');
  if (tbt) tbt.onclick = async () => {
    const para = ov.querySelector('#tps').value; if (!para) return toast('Escolha o setor.', true);
    await q(sb.rpc('transferir_aluno', { p_aluno: id, p_para: +para, p_motivo: ov.querySelector('#tmo').value || null }));
    toast('Aluno transferido.'); fechar(); ir(S.view);
  };
  const pbt = ov.querySelector('#pbt');
  if (pbt) pbt.onclick = async () => { await q(sb.rpc('definir_pin', { p_aluno: id, p_pin: ov.querySelector('#pin').value })); toast('PIN definido.'); ov.querySelector('#pin').value = ''; };
  ov.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
    const m = prompt('Motivo do cancelamento:'); if (!m) return;
    await q(sb.rpc('cancelar_registro', { p_id: +b.dataset.c, p_motivo: m })); toast('Registro cancelado.'); fechar(); abrirAluno(id);
  });
}

// ---------- Registrar presença (líder e NAF) ----------
VIEWS.ponto = async () => {
  let meus;
  if (S.perfil.papel === 'naf') meus = S.setores;
  else {
    const ids = (await q(sb.from('lideres_setor').select('setor_id').eq('user_id', S.perfil.user_id))).map(r => r.setor_id);
    meus = S.setores.filter(s => ids.includes(s.id) || ids.includes(s.setor_pai_id));
  }
  if (!meus.length) { document.getElementById('main').innerHTML = '<div class="card">Você ainda não foi vinculado a nenhum setor. Fale com o NAF.</div>'; return; }
  if (!S.setorAtivo || !meus.some(s => s.id === S.setorAtivo)) S.setorAtivo = meus[0].id;
  const setor = S.setores.find(s => s.id === S.setorAtivo);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const [alunos, regs] = await Promise.all([
    q(sb.from('alunos').select('id,ra,nome').eq('setor_id', setor.id).eq('ativo', true).order('nome')),
    q(sb.from('registros').select('aluno_id,tipo,ts').eq('setor_id', setor.id).eq('cancelado', false).gte('ts', hoje.toISOString()).order('ts')),
  ]);
  const ult = {}; regs.forEach(r => (ult[r.aluno_id] = r));
  const turno = setor.turno_fixo_horas;
  const modos = { lider: 'O líder registra a presença', aluno: 'Cada aluno registra no próprio login', quiosque: 'Computador do setor (RA + PIN)' };
  document.getElementById('main').innerHTML = `
  <div class="card">
    <div class="row">
      <div class="grow"><label>Setor</label><select id="ss">${meus.map(s => `<option value="${s.id}" ${s.id === setor.id ? 'selected' : ''}>${esc(nomeSetor(s.id))}</option>`).join('')}</select></div>
      <div class="grow"><label>Como este setor registra a presença</label><select id="modo">${Object.entries(modos).map(([k, t]) => `<option value="${k}" ${setor.modo_ponto === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    </div>
    ${setor.modo_ponto === 'quiosque' ? '<button class="btn primary block" id="kq">Abrir modo quiosque neste computador</button>' : ''}
    ${setor.modo_ponto === 'aluno' ? '<div class="muted small" style="margin-top:10px">Os alunos registram a presença no próprio login. Você ainda pode registrar por eles abaixo.</div>' : ''}
  </div>
  <div class="card"><div class="row"><h2 class="grow">${esc(setor.nome)} · ${alunos.length} aluno(s)</h2>
    <input id="bp" placeholder="Buscar" style="width:200px"></div>
    <div class="alunos-ponto" id="lap" style="margin-top:12px"></div></div>`;
  const render = () => {
    const t = document.getElementById('bp').value.toLowerCase();
    document.getElementById('lap').innerHTML = alunos.filter(a => !t || a.nome.toLowerCase().includes(t) || a.ra.includes(t)).map(a => {
      const u = ult[a.id]; const dentro = u && u.tipo === 'entrada';
      return `<div class="ap ${dentro ? 'dentro' : ''}"><div class="n">${esc(a.nome)}</div>
        <div class="muted small">RA ${esc(a.ra)}${u ? ` · ${u.tipo === 'entrada' ? 'entrou' : 'saiu'} às ${hora(u.ts)}` : ''}</div>
        <div class="row">${turno ? `<button class="btn sm primary" data-t="${a.id}">+${h1(turno)}h turno</button>`
          : `<button class="btn sm ${dentro ? 'bad' : 'ok'}" data-p="${a.id}">${dentro ? 'Registrar saída' : 'Registrar entrada'}</button>`}</div></div>`;
    }).join('') || '<div class="muted">Nenhum aluno.</div>';
    document.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => {
      b.disabled = true; const r = await q(sb.rpc('bater_ponto', { p_aluno: b.dataset.p }));
      toast(`${r.tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada às ${hora(r.ts)}.`); VIEWS.ponto();
    });
    document.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => {
      const ini = prompt('Início do turno (HH:MM)', '08:00'); if (!ini) return;
      const [hh, mm] = ini.split(':').map(Number); const d = new Date(); d.setHours(hh, mm || 0, 0, 0);
      await q(sb.rpc('lancar_turno', { p_aluno: b.dataset.t, p_inicio: d.toISOString() })); toast('Turno lançado.'); VIEWS.ponto();
    });
  };
  document.getElementById('bp').oninput = render; render();
  document.getElementById('ss').onchange = e => { S.setorAtivo = +e.target.value; VIEWS.ponto(); };
  document.getElementById('modo').onchange = async e => {
    await q(sb.rpc('definir_modo_ponto', { p_setor: setor.id, p_modo: e.target.value }));
    setor.modo_ponto = e.target.value; toast('Modo atualizado.'); VIEWS.ponto();
  };
  const kq = document.getElementById('kq'); if (kq) kq.onclick = () => quiosque(setor);
};

// ---------- Quiosque ----------
function quiosque(setor) {
  $app.innerHTML = `<div class="kiosk"><button class="btn sm sair" id="ks">Sair do quiosque</button><div class="box">
    <div class="muted" style="color:#cfdaea">${esc(nomeSetor(setor.id))}</div><div class="clock" id="clk"></div>
    <form id="kf"><input id="kra" placeholder="Seu RA" inputmode="numeric" autocomplete="off" required>
    <input id="kpin" type="password" placeholder="PIN" inputmode="numeric" maxlength="6" autocomplete="off" required>
    <button class="btn block" style="font-size:18px;padding:14px">Registrar presença</button></form><div class="msg" id="km"></div></div></div>`;
  const tick = () => { const c = document.getElementById('clk'); if (c) c.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  tick(); const iv = setInterval(tick, 10000);
  document.getElementById('kra').focus();
  document.getElementById('kf').onsubmit = async e => {
    e.preventDefault(); const m = document.getElementById('km');
    const { data, error } = await sb.rpc('bater_ponto_quiosque', { p_setor: setor.id, p_ra: document.getElementById('kra').value, p_pin: document.getElementById('kpin').value });
    document.getElementById('kra').value = ''; document.getElementById('kpin').value = ''; document.getElementById('kra').focus();
    if (error || !data.ok) { m.className = 'msg bad'; m.textContent = error ? error.message : data.erro; }
    else { m.className = 'msg ok'; m.textContent = `${data.tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada — ${data.nome.split(' ')[0]}, ${hora(data.ts)}`; }
    clearTimeout(m._t); m._t = setTimeout(() => (m.textContent = ''), 6000);
  };
  document.getElementById('ks').onclick = () => {
    const s = prompt('Para sair do quiosque, digite a senha do líder:'); if (!s) return;
    sb.auth.getUser().then(async ({ data: { user } }) => {
      const { error } = await sb.auth.signInWithPassword({ email: user.email, password: s });
      if (error) return toast('Senha incorreta.', true);
      clearInterval(iv); ir('ponto');
    });
  };
}

// ---------- Setores (NAF) ----------
VIEWS.setores = async () => {
  const contagem = await q(sb.from('alunos').select('setor_id').eq('ativo', true));
  const n = {}; contagem.forEach(a => (n[a.setor_id] = (n[a.setor_id] || 0) + 1));
  document.getElementById('main').innerHTML = `
  <div class="card"><h2>Novo setor ou subsetor</h2>
    <form id="fs" class="row"><input class="grow" name="nome" placeholder="Nome" required>
      <select name="pai" style="width:auto;max-width:280px">${optsSetor('', 'Setor principal (sem pai)')}</select>
      <input name="turno" type="number" step="0.5" min="0" placeholder="Turno fixo (h)" style="width:150px">
      <button class="btn primary">Criar</button></form>
    <div class="muted small" style="margin-top:6px">Subsetor: escolha o setor pai. O líder do setor pai enxerga os subsetores. "Turno fixo" lança entrada + saída de uma vez (ex.: 4h na Conservação).</div></div>
  <div class="card scroll"><table><thead><tr><th>Setor</th><th class="num">Alunos</th><th>Modo de registro</th><th>Turno fixo</th><th></th></tr></thead><tbody>
    ${setoresOrdenados().map(s => `<tr><td>${s.setor_pai_id ? '<span class="muted">└ </span>' : ''}${esc(s.nome)}</td><td class="num">${n[s.id] || 0}</td>
      <td><span class="tag">${esc(s.modo_ponto)}</span></td><td>${s.turno_fixo_horas ? h1(s.turno_fixo_horas) + 'h' : '—'}</td>
      <td><button class="btn sm" data-e="${s.id}">Editar</button></td></tr>`).join('')}
  </tbody></table></div>`;
  document.getElementById('fs').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target).entries());
    await q(sb.from('setores').insert({ nome: d.nome.trim(), setor_pai_id: d.pai ? +d.pai : null, turno_fixo_horas: d.turno ? +d.turno : null }));
    S.setores = await q(sb.from('setores').select('*').order('nome')); toast('Setor criado.'); VIEWS.setores();
  };
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => {
    const s = S.setores.find(x => x.id === +b.dataset.e);
    const nome = prompt('Nome do setor:', s.nome); if (nome === null) return;
    const turno = prompt('Turno fixo em horas (vazio = sem turno fixo):', s.turno_fixo_horas ?? ''); if (turno === null) return;
    await q(sb.from('setores').update({ nome: nome.trim(), turno_fixo_horas: turno === '' ? null : +turno }).eq('id', s.id));
    S.setores = await q(sb.from('setores').select('*').order('nome')); toast('Setor atualizado.'); VIEWS.setores();
  });
};

// ---------- Aluno: meu saldo ----------
VIEWS.meu = async () => {
  const [s] = await q(sb.from('v_saldos').select('*'));
  const regs = await q(sb.from('registros').select('*').eq('cancelado', false).order('ts', { ascending: false }).limit(20));
  const setor = s && S.setores.find(x => x.id === s.setor_id);
  document.getElementById('main').innerHTML = !s ? '<div class="card">Seu cadastro não está ativo. Procure o NAF.</div>' : `
  <div class="card"><h2>${esc(s.nome)}</h2><div class="muted">${esc(nomeSetor(s.setor_id))} · ${esc(s.plano || '')} · ${h1(s.horas_semana)}h por semana</div>
    ${setor && setor.modo_ponto === 'aluno' ? '<button class="btn primary block" id="bater">Registrar presença agora</button>' : ''}</div>
  <div class="grid kpis">
    <div class="kpi"><div class="muted small">Previsto até hoje</div><div class="v">${h1(s.meta_mes)}h</div></div>
    <div class="kpi"><div class="muted small">Cumpridas no mês</div><div class="v">${h1(s.feitas_mes)}h</div></div>
    <div class="kpi ${s.saldo_mes < -0.05 ? 'bad' : 'ok'}"><div class="muted small">Saldo do mês</div><div class="v">${s.saldo_mes > 0 ? '+' : ''}${h1(s.saldo_mes)}h</div></div>
    <div class="kpi ${s.saldo_mes_ant < -0.05 ? 'bad' : 'ok'}"><div class="muted small">Mês passado</div><div class="v">${s.saldo_mes_ant > 0 ? '+' : ''}${h1(s.saldo_mes_ant)}h</div></div>
  </div>
  ${s.dias_sem_par ? `<div class="card" style="margin-top:16px"><span class="tag warn">Atenção</span> ${s.dias_sem_par} dia(s) com entrada sem saída (ou vice-versa) não estão contando horas. Fale com seu líder.</div>` : ''}
  <div class="split" style="margin-top:16px">
    <div class="card"><h2>Últimos registros</h2>${regs.length ? `<table><tbody>${regs.map(r => `<tr><td>${dataHora(r.ts)}</td><td>${r.tipo === 'entrada' ? '▶ Entrada' : '■ Saída'}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Nenhum registro ainda.</div>'}</div>
    <div class="card"><h2>PIN do quiosque</h2><div class="muted small">Usado para registrar presença no computador do setor.</div>
      <div class="row" style="margin-top:8px"><input id="pin" class="grow" type="password" inputmode="numeric" maxlength="6" placeholder="4 a 6 números"><button class="btn" id="pbt">Salvar PIN</button></div>
      <hr><h2>Trocar senha</h2><div class="row"><input id="ns" class="grow" type="password" placeholder="Nova senha (mín. 8)"><button class="btn" id="nsb">Trocar</button></div></div>
  </div>`;
  if (!s) return;
  const b = document.getElementById('bater');
  if (b) b.onclick = async () => { b.disabled = true; const r = await q(sb.rpc('bater_ponto', { p_aluno: s.aluno_id })); toast(`${r.tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada às ${hora(r.ts)}.`); VIEWS.meu(); };
  document.getElementById('pbt').onclick = async () => { await q(sb.rpc('definir_pin', { p_aluno: s.aluno_id, p_pin: document.getElementById('pin').value })); toast('PIN salvo.'); document.getElementById('pin').value = ''; };
  document.getElementById('nsb').onclick = async () => {
    const p = document.getElementById('ns').value; if (p.length < 8) return toast('A senha precisa de pelo menos 8 caracteres.', true);
    await q(sb.auth.updateUser({ password: p })); toast('Senha trocada.'); document.getElementById('ns').value = '';
  };
};

sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.perfil) telaLogin(); });
iniciar();
