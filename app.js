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
const setoresVisiveis = () => S.perfil?.papel === 'lider' ? setoresOrdenados().filter(s => (S.meusSetores || []).includes(s.id)) : setoresOrdenados();
const optsSetor = (sel, vazio, todos) => (vazio ? `<option value="">${vazio}</option>` : '') +
  (todos ? setoresOrdenados() : setoresVisiveis()).map(s => `<option value="${s.id}" ${s.id == sel ? 'selected' : ''}>${esc(nomeSetor(s.id))}</option>`).join('');

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
  if (perfil.troca_senha) return telaTrocaSenha();
  if (perfil.papel === 'naf') return ir('painel');
  if (perfil.papel === 'lider') {
    const ids = (await q(sb.from('lideres_setor').select('setor_id').eq('user_id', perfil.user_id))).map(r => r.setor_id);
    S.meusSetores = S.setores.filter(s => ids.includes(s.id) || ids.includes(s.setor_pai_id)).map(s => s.id);
    return ir('visao');
  }
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

function telaTrocaSenha() {
  $app.innerHTML = `
  <div class="center"><form class="login" id="f">
    <div class="logo">AE</div><h1>Crie sua senha</h1>
    <div class="muted small">No primeiro acesso, troque a senha que você recebeu do NAF.</div>
    <label for="n1">Nova senha (mínimo 8 caracteres)</label><input id="n1" type="password" autocomplete="new-password" minlength="8" required>
    <label for="n2">Repita a nova senha</label><input id="n2" type="password" autocomplete="new-password" minlength="8" required>
    <button class="btn primary block" id="b">Salvar e entrar</button><div class="err" id="e"></div>
  </form></div>`;
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault();
    const a = document.getElementById('n1').value, b = document.getElementById('n2').value, e = document.getElementById('e');
    if (a.length < 8) return (e.textContent = 'A senha precisa ter pelo menos 8 caracteres.');
    if (a !== b) return (e.textContent = 'As senhas não conferem.');
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return (e.textContent = error.message.includes('different') ? 'Escolha uma senha diferente da atual.' : error.message);
    await q(sb.rpc('marcar_senha_trocada'));
    S.perfil.troca_senha = false; toast('Senha criada.'); iniciar();
  };
}

// ---------- gestão de acessos (Edge Function, só NAF) ----------
async function adminFn(acao, corpo = {}) {
  const { data, error } = await sb.functions.invoke('admin-usuarios', { body: { acao, ...corpo } });
  let msg = data?.erro;
  if (error && !msg) { try { msg = (await error.context.json()).erro; } catch { msg = error.message; } }
  if (msg) { toast(msg, true); throw new Error(msg); }
  return data;
}
function senhaSugerida() {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(r, n => c[n % c.length]).join('');
}

// ---------- casca ----------
const MENUS = {
  naf: [['painel', 'Painel'], ['alunos', 'Alunos'], ['ponto', 'Registrar presença'], ['calendario', 'Calendário'], ['pedidos', 'Pedidos'], ['setores', 'Setores'], ['acessos', 'Acessos']],
  lider: [['visao', 'Visão geral'], ['alunos', 'Alunos'], ['ponto', 'Registrar presença'], ['calendario', 'Calendário'], ['pedidos', 'Pedidos']],
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
      <button class="btn" id="xls">Exportar Excel</button>
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
  if (naf) document.getElementById('novo').onclick = () => abrirAluno(null);
  document.getElementById('xls').onclick = () => exportarExcel(S._lista);
};

// ---------- Ficha do aluno (drawer) ----------
async function abrirAluno(id) {
  const naf = S.perfil.papel === 'naf';
  const a = id ? (await q(sb.from('alunos').select('id,ra,nome,nascimento,telefone,curso,semestre,plano,setor_id,plantao_setor_id,horas_semana,observacao,ativo,dias_trabalho,escala_alternada,dias_trabalho_b,dias_ref_a').eq('id', id)))[0]
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
    ${id ? '<button class="btn sm" id="vcal" style="margin-top:10px">📅 Calendário deste aluno</button>' : ''}
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
      <div class="full"><label>Plantão</label><select name="plantao_setor_id" ${dis}>${optsSetor(a.plantao_setor_id, 'Nenhum', true)}</select></div>
      <div class="full"><label>Observação</label><textarea name="observacao" rows="2" ${dis}>${esc(a.observacao)}</textarea></div>
      ${naf ? `<div class="full"><label><input type="checkbox" name="ativo" style="width:auto" ${a.ativo ? 'checked' : ''}> Ativo</label></div>` : ''}
    </div>${naf ? '<button class="btn primary block">Salvar</button>' : ''}</form>
    ${id && naf ? `<hr><h3>Transferir de setor</h3>
      <div class="row"><select id="tps" class="grow">${optsSetor('', 'Novo setor…', true)}</select><button class="btn" id="tbt">Transferir</button></div>
      <input id="tmo" placeholder="Motivo (opcional)" style="margin-top:8px">
      ${trans.length ? `<div class="muted small" style="margin-top:8px">${trans.map(t => `${dataHora(t.em)}: ${esc(nomeSetor(t.de_setor))} → ${esc(nomeSetor(t.para_setor))}`).join('<br>')}</div>` : ''}
      <hr><h3>Acesso do aluno</h3><div id="acesso" class="muted small">Verificando…</div>
      <hr><h3>PIN do quiosque</h3><div class="row"><input id="pin" class="grow" inputmode="numeric" maxlength="6" placeholder="4 a 6 números"><button class="btn" id="pbt">Definir PIN</button></div>` : ''}
    ${id ? `<hr><h3>Dias combinados de atividade</h3><div id="dias"></div>` : ''}
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
  const vcal = ov.querySelector('#vcal');
  if (vcal) vcal.onclick = () => { S.calAluno = id; fechar(); ir('calendario'); };
  const dz = ov.querySelector('#dias');
  if (dz) editorDias(dz, a, naf || S.perfil.papel === 'lider');
  const tbt = ov.querySelector('#tbt');
  if (tbt) tbt.onclick = async () => {
    const para = ov.querySelector('#tps').value; if (!para) return toast('Escolha o setor.', true);
    await q(sb.rpc('transferir_aluno', { p_aluno: id, p_para: +para, p_motivo: ov.querySelector('#tmo').value || null }));
    toast('Aluno transferido.'); fechar(); ir(S.view);
  };
  const acesso = ov.querySelector('#acesso');
  if (acesso) {
    const conta = (await q(sb.from('perfis').select('user_id,ativo,troca_senha').eq('aluno_id', id)))[0];
    acesso.innerHTML = conta
      ? `<div>Login: <b>RA ${esc(a.ra)}</b> · ${conta.ativo ? '<span class="tag ok">ativo</span>' : '<span class="tag bad">desativado</span>'} ${conta.troca_senha ? '<span class="tag warn">ainda não trocou a senha</span>' : ''}</div>
         <div class="row" style="margin-top:8px"><input id="ns" class="grow" value="${senhaSugerida()}"><button class="btn" id="rs">Resetar senha</button>
         <button class="btn ${conta.ativo ? 'bad' : 'ok'}" id="at">${conta.ativo ? 'Desativar' : 'Reativar'}</button></div>`
      : `<div>Este aluno ainda não tem login.</div><div class="row" style="margin-top:8px"><input id="ns" class="grow" value="${senhaSugerida()}"><button class="btn primary" id="ca">Criar acesso</button></div>
         <div style="margin-top:6px">Ele entra com o <b>RA</b> e essa senha inicial, e cria a própria senha no primeiro acesso.</div>`;
    const ns = () => ov.querySelector('#ns').value;
    const ca = ov.querySelector('#ca'); if (ca) ca.onclick = async () => { ca.disabled = true; try { await adminFn('criar_login_aluno', { aluno_id: id, senha: ns() }); toast(`Acesso criado. Login: RA ${a.ra} · senha inicial: ${ns()}`); fechar(); abrirAluno(id); } catch { ca.disabled = false; } };
    const rs = ov.querySelector('#rs'); if (rs) rs.onclick = async () => { await adminFn('resetar_senha', { user_id: conta.user_id, senha: ns() }); toast(`Senha resetada. Nova senha inicial: ${ns()}`); };
    const at = ov.querySelector('#at'); if (at) at.onclick = async () => { await adminFn('definir_ativo', { user_id: conta.user_id, ativo: !conta.ativo }); toast(conta.ativo ? 'Acesso desativado.' : 'Acesso reativado.'); fechar(); abrirAluno(id); };
  }
  const pbt = ov.querySelector('#pbt');
  if (pbt) pbt.onclick = async () => { await q(sb.rpc('definir_pin', { p_aluno: id, p_pin: ov.querySelector('#pin').value })); toast('PIN definido.'); ov.querySelector('#pin').value = ''; };
  ov.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
    const m = prompt('Motivo do cancelamento:'); if (!m) return;
    await q(sb.rpc('cancelar_registro', { p_id: +b.dataset.c, p_motivo: m })); toast('Registro cancelado.'); fechar(); abrirAluno(id);
  });
}

// ---------- Registrar presença (líder e NAF) ----------
VIEWS.ponto = async () => {
  const meus = S.perfil.papel === 'naf' ? S.setores : S.setores.filter(s => (S.meusSetores || []).includes(s.id));
  if (!meus.length) { document.getElementById('main').innerHTML = '<div class="card">Você ainda não foi vinculado a nenhum setor. Fale com o NAF.</div>'; return; }
  if (!S.setorAtivo || !meus.some(s => s.id === S.setorAtivo)) S.setorAtivo = meus[0].id;
  const setor = S.setores.find(s => s.id === S.setorAtivo);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const [alunos, regs, saldos] = await Promise.all([
    q(sb.from('alunos').select('id,ra,nome').eq('setor_id', setor.id).eq('ativo', true).order('nome')),
    q(sb.from('registros').select('aluno_id,tipo,ts').eq('setor_id', setor.id).eq('cancelado', false).gte('ts', hoje.toISOString()).order('ts')),
    q(sb.from('v_saldos').select('aluno_id,saldo_mes').eq('setor_id', setor.id)),
  ]);
  const ult = {}; regs.forEach(r => (ult[r.aluno_id] = r));
  const sal = {}; saldos.forEach(s => (sal[s.aluno_id] = s.saldo_mes));
  const turno = setor.turno_fixo_horas;
  const sel = new Set(); let modoLote = false;
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
    <input id="bp" placeholder="Buscar" style="width:180px"><button class="btn" id="lote">Selecionar vários</button></div>
    <div id="barra" class="row" style="margin-top:10px;display:none;background:#eef2f7;padding:10px;border-radius:10px">
      <b id="nsel">0 selecionado(s)</b><button class="btn sm" id="todos">Marcar todos</button><span class="grow"></span>
      ${turno ? `<button class="btn sm primary" id="lt">+${h1(turno)}h turno</button>` : '<button class="btn sm ok" id="le">Registrar entrada</button><button class="btn sm bad" id="ls">Registrar saída</button>'}
    </div>
    <div class="alunos-ponto" id="lap" style="margin-top:12px"></div></div>`;
  const render = () => {
    const t = document.getElementById('bp').value.toLowerCase();
    document.getElementById('lap').innerHTML = alunos.filter(a => !t || a.nome.toLowerCase().includes(t) || a.ra.includes(t)).map(a => {
      const u = ult[a.id]; const dentro = u && u.tipo === 'entrada';
      return `<div class="ap ${dentro ? 'dentro' : ''}" ${modoLote ? `data-s="${a.id}" style="cursor:pointer"` : ''}>
        <div class="row" style="margin:0">${modoLote ? `<input type="checkbox" style="width:auto" ${sel.has(a.id) ? 'checked' : ''}>` : ''}<div class="n grow">${esc(a.nome)}</div></div>
        <div class="muted small">RA ${esc(a.ra)}${u ? ` · ${u.tipo === 'entrada' ? 'entrou' : 'saiu'} às ${hora(u.ts)}` : ''} · mês ${sinal(sal[a.id])}</div>
        ${modoLote ? '' : `<div class="row">${turno ? `<button class="btn sm primary" data-t="${a.id}">+${h1(turno)}h turno</button>`
          : `<button class="btn sm ${dentro ? 'bad' : 'ok'}" data-p="${a.id}">${dentro ? 'Registrar saída' : 'Registrar entrada'}</button>`}
          <button class="btn sm" data-cal="${a.id}">Calendário</button></div>`}</div>`;
    }).join('') || '<div class="muted">Nenhum aluno.</div>';
    document.getElementById('nsel').textContent = `${sel.size} selecionado(s)`;
    document.querySelectorAll('[data-s]').forEach(c => c.onclick = () => { sel.has(c.dataset.s) ? sel.delete(c.dataset.s) : sel.add(c.dataset.s); render(); });
    document.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => {
      b.disabled = true; const r = await q(sb.rpc('bater_ponto', { p_aluno: b.dataset.p }));
      toast(`${r.tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada às ${hora(r.ts)}.`); VIEWS.ponto();
    });
    document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => lancarTurnos([b.dataset.t]));
    document.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => { S.calAluno = b.dataset.cal; ir('calendario'); });
  };
  const lancarTurnos = async ids => {
    const ini = prompt('Início do turno (HH:MM)', '08:00'); if (!ini) return;
    const [hh, mm] = ini.split(':').map(Number); const d = new Date(); d.setHours(hh, mm || 0, 0, 0);
    let ok = 0; for (const id of ids) { try { await q(sb.rpc('lancar_turno', { p_aluno: id, p_inicio: d.toISOString() })); ok++; } catch {} }
    toast(`Turno lançado para ${ok} aluno(s).`); VIEWS.ponto();
  };
  const lote = async tipo => {
    if (!sel.size) return toast('Selecione ao menos um aluno.', true);
    let ok = 0; for (const id of sel) { try { await q(sb.rpc('bater_ponto', { p_aluno: id, p_tipo: tipo })); ok++; } catch {} }
    toast(`${tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada para ${ok} aluno(s).`); VIEWS.ponto();
  };
  document.getElementById('bp').oninput = render; render();
  document.getElementById('lote').onclick = e => {
    modoLote = !modoLote; sel.clear(); e.target.textContent = modoLote ? 'Cancelar seleção' : 'Selecionar vários';
    document.getElementById('barra').style.display = modoLote ? 'flex' : 'none'; render();
  };
  document.getElementById('todos').onclick = () => { alunos.forEach(a => sel.add(a.id)); render(); };
  const le = document.getElementById('le'); if (le) le.onclick = () => lote('entrada');
  const ls = document.getElementById('ls'); if (ls) ls.onclick = () => lote('saida');
  const lt = document.getElementById('lt'); if (lt) lt.onclick = () => sel.size ? lancarTurnos([...sel]) : toast('Selecione ao menos um aluno.', true);
  document.getElementById('ss').onchange = e => { S.setorAtivo = +e.target.value; VIEWS.ponto(); };
  document.getElementById('modo').onchange = async e => {
    await q(sb.rpc('definir_modo_ponto', { p_setor: setor.id, p_modo: e.target.value }));
    setor.modo_ponto = e.target.value; toast('Modo atualizado.'); VIEWS.ponto();
  };
  const kq = document.getElementById('kq'); if (kq) kq.onclick = () => quiosque(setor);
};

// ---------- Visão geral do líder ----------
VIEWS.visao = async () => {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const [saldos, pedidos, regsHoje, alunos, recentes] = await Promise.all([
    q(sb.from('v_saldos').select('*')),
    q(sb.from('pedidos').select('id').eq('status', 'aguardando')),
    q(sb.from('registros').select('aluno_id,tipo,ts').eq('cancelado', false).gte('ts', hoje.toISOString()).order('ts')),
    q(sb.from('alunos').select('id,nome,nascimento,setor_id').eq('ativo', true)),
    q(sb.from('registros').select('ts,tipo,origem,alunos(nome)').eq('cancelado', false).order('ts', { ascending: false }).limit(12)),
  ]);
  const ult = {}; regsHoje.forEach(r => (ult[r.aluno_id] = r.tipo));
  const presentes = Object.values(ult).filter(t => t === 'entrada').length;
  const mes = new Date().getMonth();
  const aniv = alunos.filter(a => a.nascimento && +a.nascimento.slice(5, 7) - 1 === mes).sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)));
  const pend = saldos.filter(s => s.saldo_mes < -0.05 || s.saldo_mes_ant < -0.05).sort((a, b) => (a.saldo_mes + Math.min(0, a.saldo_mes_ant)) - (b.saldo_mes + Math.min(0, b.saldo_mes_ant)));
  document.getElementById('main').innerHTML = `
  <div class="grid kpis">
    <div class="kpi"><div class="muted small">Bolsistas ativos</div><div class="v">${saldos.length}</div></div>
    <div class="kpi ok"><div class="muted small">Presentes agora</div><div class="v">${presentes}</div></div>
    <div class="kpi warn"><div class="muted small">Pedidos aguardando</div><div class="v">${pedidos.length}</div></div>
    <div class="kpi bad"><div class="muted small">Com horas pendentes</div><div class="v">${pend.length}</div></div>
  </div>
  <div class="split" style="margin-top:16px">
    <div class="card"><h2>Maiores pendências</h2><div class="scroll"><table><thead><tr><th>Aluno</th><th class="num">Este mês</th><th class="num">Mês passado</th></tr></thead><tbody>
      ${pend.slice(0, 10).map(s => `<tr class="click" data-a="${s.aluno_id}"><td>${esc(s.nome)}<div class="muted small">${esc(nomeSetor(s.setor_id))}</div></td><td class="num">${sinal(s.saldo_mes)}</td><td class="num">${sinal(s.saldo_mes_ant)}</td></tr>`).join('') || '<tr><td class="muted">Ninguém com horas pendentes.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><h2>🎂 Aniversariantes do mês</h2>
      ${aniv.map(a => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="grow">${esc(a.nome)}</span><span class="tag">${a.nascimento.slice(8)}/${a.nascimento.slice(5, 7)}</span></div>`).join('') || '<div class="muted">Nenhum este mês.</div>'}
      <hr><h2>Atividade recente</h2>
      ${recentes.map(r => `<div class="small" style="padding:4px 0">${dataHora(r.ts)} · <b>${esc(r.alunos?.nome || '')}</b> · ${r.tipo === 'entrada' ? 'entrada' : 'saída'} <span class="muted">(${esc(r.origem)})</span></div>`).join('') || '<div class="muted">Nada ainda.</div>'}
    </div>
  </div>
  ${pedidos.length ? `<div class="card"><div class="row"><span class="grow">Há <b>${pedidos.length}</b> pedido(s) de ajuste aguardando sua resposta.</span><button class="btn primary" id="vped">Ver pedidos</button></div></div>` : ''}`;
  document.querySelectorAll('tr[data-a]').forEach(tr => tr.onclick = () => abrirAluno(tr.dataset.a));
  const vp = document.getElementById('vped'); if (vp) vp.onclick = () => ir('pedidos');
};

// ---------- Dias combinados / escala alternada ----------
const DK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DORD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
const DNOME = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' };
const isoDia = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const segundaDe = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function semanaDaEscala(a, d) {
  if (!a.escala_alternada || !a.dias_ref_a) return 1;
  const ref = new Date(a.dias_ref_a + 'T00:00:00');
  const n = Math.round((segundaDe(d) - segundaDe(ref)) / (7 * 864e5));
  return ((n % 2) + 2) % 2 === 0 ? 1 : 2;
}
function diasNaData(a, d) {
  const lista = semanaDaEscala(a, d) === 2 ? (a.dias_trabalho_b || []) : (a.dias_trabalho || []);
  return lista.includes(DK[d.getDay()]);
}
function editorDias(el, a, editavel) {
  const caixas = (nome, lista) => DORD.map(k => `<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 10px 4px 0;font-weight:500">
      <input type="checkbox" name="${nome}" value="${k}" style="width:auto" ${(lista || []).includes(k) ? 'checked' : ''} ${editavel ? '' : 'disabled'}>${DNOME[k]}</label>`).join('');
  el.innerHTML = `<form id="fd">
    <div class="muted small" id="lsa">${a.escala_alternada ? 'Semana 1' : ''}</div><div>${caixas('a', a.dias_trabalho)}</div>
    <label style="display:flex;align-items:center;gap:6px;margin-top:8px"><input type="checkbox" id="alt" style="width:auto" ${a.escala_alternada ? 'checked' : ''} ${editavel ? '' : 'disabled'}> Escala alternada (semanas diferentes)</label>
    <div id="sb" style="display:${a.escala_alternada ? 'block' : 'none'}">
      <div class="muted small">Semana 2</div><div>${caixas('b', a.dias_trabalho_b)}</div>
      <label>Segunda-feira de uma "Semana 1"</label><input type="date" id="ref" value="${esc(a.dias_ref_a || isoDia(segundaDe(new Date())))}" ${editavel ? '' : 'disabled'}>
    </div>
    ${editavel ? '<button class="btn block">Salvar dias</button>' : ''}</form>`;
  const alt = el.querySelector('#alt');
  alt.onchange = () => { el.querySelector('#sb').style.display = alt.checked ? 'block' : 'none'; el.querySelector('#lsa').textContent = alt.checked ? 'Semana 1' : ''; };
  el.querySelector('#fd').onsubmit = async e => {
    e.preventDefault(); if (!editavel) return;
    const pega = n => Array.from(el.querySelectorAll(`input[name="${n}"]:checked`), i => i.value);
    await q(sb.rpc('definir_dias', { p_aluno: a.id, p_dias: pega('a'), p_alternada: alt.checked, p_dias_b: alt.checked ? pega('b') : null, p_ref: alt.checked ? el.querySelector('#ref').value : null }));
    toast('Dias combinados salvos.');
  };
}

// ---------- Calendário ----------
function horasPorDia(regs) {
  const dias = {};
  regs.forEach(r => { const k = isoDia(new Date(r.ts)); (dias[k] = dias[k] || []).push(r); });
  const out = {};
  for (const [k, l] of Object.entries(dias)) {
    l.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const ent = l.filter(r => r.tipo === 'entrada').length, sai = l.length - ent;
    let min = 0;
    for (let i = 0; i < l.length - 1; i++) if (l[i].tipo === 'entrada' && l[i + 1].tipo === 'saida') min += (new Date(l[i + 1].ts) - new Date(l[i].ts)) / 60000;
    out[k] = { regs: l, semPar: ent !== sai, horas: ent !== sai ? 0 : min / 60 };
  }
  return out;
}
VIEWS.calendario = async () => {
  const gestor = S.perfil.papel !== 'aluno';
  const lista = gestor ? await q(sb.from('alunos').select('id,nome,ra,setor_id').eq('ativo', true).order('nome')) : [];
  if (gestor && !lista.length) { document.getElementById('main').innerHTML = '<div class="card">Nenhum aluno no seu setor.</div>'; return; }
  if (gestor && (!S.calAluno || !lista.some(a => a.id === S.calAluno))) S.calAluno = lista[0].id;
  document.getElementById('main').innerHTML = `${gestor ? `<div class="card"><label>Aluno</label>
    <input id="cbusca" placeholder="Buscar aluno por nome ou RA" list="cl" value="${esc((lista.find(a => a.id === S.calAluno) || {}).nome)}">
    <datalist id="cl">${lista.map(a => `<option value="${esc(a.nome)}">RA ${esc(a.ra)} · ${esc(nomeSetor(a.setor_id))}</option>`).join('')}</datalist></div>` : ''}
    <div id="calbox"></div>`;
  if (gestor) document.getElementById('cbusca').onchange = e => {
    const v = e.target.value.trim().toLowerCase(); const a = lista.find(x => x.nome.toLowerCase() === v || x.ra === v);
    if (a) { S.calAluno = a.id; calendario(document.getElementById('calbox'), a.id, true); }
  };
  calendario(document.getElementById('calbox'), gestor ? S.calAluno : S.meuAlunoId, gestor);
};
async function calendario(box, alunoId, gestor, mesRef) {
  const ref = mesRef || new Date(); const ini = new Date(ref.getFullYear(), ref.getMonth(), 1); const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const seg = segundaDe(new Date()); const desde = seg < ini ? seg : ini;
  const [[a], [s], regs] = await Promise.all([
    q(sb.from('alunos').select('id,nome,ra,setor_id,dias_trabalho,escala_alternada,dias_trabalho_b,dias_ref_a').eq('id', alunoId)),
    q(sb.from('v_saldos').select('*').eq('aluno_id', alunoId)),
    q(sb.from('registros').select('id,tipo,ts,origem').eq('aluno_id', alunoId).eq('cancelado', false).gte('ts', desde.toISOString()).lt('ts', fim > new Date() ? new Date(Date.now() + 864e5).toISOString() : fim.toISOString()).order('ts')),
  ]);
  if (!a) { box.innerHTML = '<div class="card">Aluno não encontrado.</div>'; return; }
  const porDia = horasPorDia(regs);
  const turno = (S.setores.find(x => x.id === a.setor_id) || {}).turno_fixo_horas;
  // cards (mês atual) com a regra de abatimento do app antigo
  const sm = s ? s.saldo_mes : 0, sa = s ? s.saldo_mes_ant : 0;
  const devAnt = Math.max(0, -sa), exced = Math.max(0, sm), abat = Math.min(exced, devAnt);
  const restAnt = devAnt - abat, folga = exced - abat;
  let semana = 0; Object.entries(porDia).forEach(([k, v]) => { if (new Date(k + 'T00:00:00') >= seg) semana += v.horas; });
  const hs = s ? s.horas_semana : 0;
  const titulo = ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  // grade
  let cel = ''; const primeiro = (ini.getDay() + 6) % 7;
  for (let i = 0; i < primeiro; i++) cel += '<div></div>';
  const hojeK = isoDia(new Date());
  for (let d = new Date(ini); d < fim; d.setDate(d.getDate() + 1)) {
    const k = isoDia(d); const info = porDia[k]; const comb = diasNaData(a, d);
    const cls = info ? (info.semPar ? 'cbad' : info.horas > 0 ? 'cok' : '') : '';
    cel += `<div class="cd ${cls} ${comb ? 'ccomb' : ''} ${k === hojeK ? 'choje' : ''}" data-d="${k}"><div class="cn">${d.getDate()}</div>${info ? `<div class="ch">${info.semPar ? 'sem par' : h1(info.horas) + 'h'}</div>` : ''}</div>`;
  }
  box.innerHTML = `
  <div class="card"><div class="row"><h2 class="grow">${esc(a.nome)} <span class="muted small">RA ${esc(a.ra)} · ${esc(nomeSetor(a.setor_id))}</span></h2></div>
  <div class="grid kpis" style="margin-top:8px">
    <div class="kpi ${sm < -0.05 ? 'bad' : 'ok'}"><div class="muted small">Horas pendentes este mês</div><div class="v">${sm < -0.05 ? h1(-sm) + 'h' : 'Em dia'}</div>${folga > 0.05 ? `<div class="small muted">+${h1(folga)}h de folga</div>` : ''}</div>
    <div class="kpi ${restAnt > 0.05 ? 'bad' : 'ok'}"><div class="muted small">Pendentes do mês passado</div><div class="v">${restAnt > 0.05 ? h1(restAnt) + 'h' : 'Quitado'}</div>${abat > 0.05 ? `<div class="small muted">${h1(abat)}h abatidas com o excedente</div>` : ''}</div>
    <div class="kpi"><div class="muted small">Esta semana</div><div class="v">${h1(semana)}h <span class="muted small">/ ${h1(hs)}h</span></div></div>
    <div class="kpi"><div class="muted small">Cumpridas no mês</div><div class="v">${h1(s ? s.feitas_mes : 0)}h <span class="muted small">/ ${h1(s ? s.meta_mes : 0)}h previstas</span></div></div>
  </div></div>
  <div class="card">
    <div class="row"><button class="btn sm" id="mp">‹</button><h2 class="grow" style="text-align:center;text-transform:capitalize;margin:0">${titulo}</h2><button class="btn sm" id="mn">›</button></div>
    <div class="cal" style="margin-top:12px">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(n => `<div class="cw">${n}</div>`).join('')}${cel}</div>
    <div class="row small muted" style="margin-top:10px;gap:14px"><span><span class="leg ccomb"></span> dia combinado</span><span><span class="leg cok"></span> presença ok</span><span><span class="leg cbad"></span> sem par (não conta)</span></div>
    <div class="muted small" style="margin-top:6px">Clique num dia para ver os horários. ${gestor ? 'Clique duas vezes para adicionar ou corrigir.' : turno ? '' : 'Clique duas vezes para pedir ajuste.'}</div>
    <div id="det" style="margin-top:12px"></div>
  </div>`;
  box.querySelector('#mp').onclick = () => calendario(box, alunoId, gestor, new Date(ref.getFullYear(), ref.getMonth() - 1, 1));
  box.querySelector('#mn').onclick = () => calendario(box, alunoId, gestor, new Date(ref.getFullYear(), ref.getMonth() + 1, 1));
  box.querySelectorAll('.cd').forEach(c => {
    c.onclick = () => {
      box.querySelectorAll('.cd').forEach(x => x.classList.remove('csel')); c.classList.add('csel');
      const info = porDia[c.dataset.d]; const dt = new Date(c.dataset.d + 'T00:00:00');
      box.querySelector('#det').innerHTML = `<b>${dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</b>
        ${diasNaData(a, dt) ? ' <span class="tag">dia combinado</span>' : ''}
        ${info ? info.regs.map(r => `<div class="small">${hora(r.ts)} · ${r.tipo === 'entrada' ? '▶ Entrada' : '■ Saída'} <span class="muted">(${esc(r.origem)})</span></div>`).join('') + `<div class="small"><b>${info.semPar ? 'Sem par — não conta horas' : h1(info.horas) + 'h no dia'}</b></div>` : '<div class="muted small">Nenhum registro.</div>'}`;
    };
    c.ondblclick = () => gestor ? popupDia(a, c.dataset.d, porDia[c.dataset.d], () => calendario(box, alunoId, gestor, ref))
      : (!turno && pedirAjuste(c.dataset.d, () => VIEWS.meu()));
  });
}
function popupDia(a, dia, info, depois) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  const dt = new Date(dia + 'T00:00:00');
  ov.innerHTML = `<div class="drawer"><button class="btn sm close" id="x">Fechar</button>
    <h2>${dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</h2><div class="muted small">${esc(a.nome)}</div>
    <hr><h3>Registros do dia</h3>
    ${info ? `<table><tbody>${info.regs.map(r => `<tr><td>${hora(r.ts)}</td><td>${r.tipo === 'entrada' ? '▶ Entrada' : '■ Saída'}</td><td class="muted small">${esc(r.origem)}</td><td><button class="btn sm" data-c="${r.id}">Remover</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted">Nenhum registro.</div>'}
    <hr><h3>Adicionar registro</h3>
    <form id="fa" class="row"><select name="tipo" style="width:auto"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
      <input name="hora" type="time" required style="width:140px"><button class="btn primary">Adicionar</button></form>
    <div class="muted small" style="margin-top:6px">${S.perfil.papel === 'lider' ? 'Líderes podem lançar e corrigir até 7 dias para trás. Datas mais antigas: peça ao NAF.' : ''} Para corrigir um horário, remova o errado e adicione o certo.</div>
  </div>`;
  document.body.appendChild(ov);
  const fechar = () => ov.remove();
  ov.querySelector('#x').onclick = fechar; ov.onclick = e => { if (e.target === ov) fechar(); };
  ov.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
    const m = prompt('Motivo da remoção (fica registrado):'); if (!m) return;
    await q(sb.rpc('cancelar_registro', { p_id: +b.dataset.c, p_motivo: m })); toast('Registro removido.'); fechar(); depois();
  });
  ov.querySelector('#fa').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const [hh, mm] = f.hora.value.split(':').map(Number);
    const ts = new Date(dt); ts.setHours(hh, mm, 0, 0);
    await q(sb.rpc('bater_ponto', { p_aluno: a.id, p_tipo: f.tipo.value, p_ts: ts.toISOString() })); toast('Registro adicionado.'); fechar(); depois();
  };
}

// ---------- Pedidos de ajuste ----------
VIEWS.pedidos = async () => {
  const filtro = S.filtroPed || 'aguardando';
  let qq = sb.from('pedidos').select('*, alunos(nome,ra)').order('criado_em', { ascending: false }).limit(300);
  if (filtro !== 'todos') qq = qq.eq('status', filtro);
  const peds = await q(qq);
  const st = { aguardando: ['Aguardando', 'warn'], aprovado: ['Aprovado', 'ok'], recusado: ['Recusado', 'bad'] };
  document.getElementById('main').innerHTML = `
  <div class="card"><div class="row"><h2 class="grow">Pedidos de ajuste</h2>
    <select id="fp" style="width:auto">${[['aguardando', 'Aguardando'], ['aprovado', 'Aprovados'], ['recusado', 'Recusados'], ['todos', 'Todos']].map(([k, t]) => `<option value="${k}" ${k === filtro ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${peds.map(p => `<div class="pend"><span class="tag ${st[p.status][1]}">${st[p.status][0]}</span>
      <div class="grow"><div><b>${esc(p.alunos?.nome || '')}</b> <span class="muted small">RA ${esc(p.alunos?.ra || '')} · ${esc(nomeSetor(p.setor_id))}</span></div>
        <div>Pede ${p.tipo_alvo === 'entrada' ? 'uma <b>entrada</b>' : 'uma <b>saída</b>'} em <b>${new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR')}</b> às <b>${p.horario.slice(0, 5)}</b></div>
        <div class="muted small">Motivo: ${esc(p.motivo)} · enviado ${dataHora(p.criado_em)}${p.resposta ? ` · resposta: ${esc(p.resposta)}` : ''}</div></div>
      ${p.status === 'aguardando' ? `<div class="row"><button class="btn sm" data-cal="${p.aluno_id}">Calendário</button><button class="btn sm bad" data-r="${p.id}">Recusar</button><button class="btn sm ok" data-ok="${p.id}">Aprovar</button></div>` : ''}
    </div>`).join('') || '<div class="muted" style="margin-top:10px">Nenhum pedido.</div>'}
  </div>`;
  document.getElementById('fp').onchange = e => { S.filtroPed = e.target.value; VIEWS.pedidos(); };
  document.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { b.disabled = true; await q(sb.rpc('resolver_pedido', { p_id: +b.dataset.ok, p_aprovar: true })); toast('Pedido aprovado e registro criado.'); VIEWS.pedidos(); });
  document.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
    const m = prompt('Motivo da recusa (o aluno vai ver):'); if (!m) return;
    await q(sb.rpc('resolver_pedido', { p_id: +b.dataset.r, p_aprovar: false, p_resposta: m })); toast('Pedido recusado.'); VIEWS.pedidos();
  });
  document.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => { S.calAluno = b.dataset.cal; ir('calendario'); });
};
function pedirAjuste(dia, depois) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="drawer"><button class="btn sm close" id="x">Fechar</button><h2>Pedir ajuste</h2>
    <div class="muted small">Seu líder vai analisar o pedido.</div>
    <form id="fj"><label>Data</label><input name="data" type="date" value="${esc(dia || isoDia(new Date()))}" max="${isoDia(new Date())}" required>
      <label>O que faltou registrar</label><select name="tipo"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
      <label>Horário</label><input name="horario" type="time" required>
      <label>Motivo</label><textarea name="motivo" rows="3" required placeholder="Ex.: esqueci de registrar a saída"></textarea>
      <button class="btn primary block">Enviar pedido</button></form></div>`;
  document.body.appendChild(ov);
  const fechar = () => ov.remove();
  ov.querySelector('#x').onclick = fechar; ov.onclick = e => { if (e.target === ov) fechar(); };
  ov.querySelector('#fj').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    await q(sb.rpc('pedir_ajuste', { p_data: f.data.value, p_tipo: f.tipo.value, p_horario: f.horario.value, p_motivo: f.motivo.value }));
    toast('Pedido enviado ao líder.'); fechar(); depois && depois();
  };
}

// ---------- Exportar Excel (aba Todos + uma por setor) ----------
async function exportarExcel(lista) {
  if (!window.XLSX) await new Promise((ok, err) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = ok; sc.onerror = err; document.head.appendChild(sc); });
  const linha = s => ({ RA: s.ra, Nome: s.nome, Setor: nomeSetor(s.setor_id), Plano: s.plano || '', 'Horas/semana': +s.horas_semana,
    'Previsto no mês': +s.meta_mes, 'Cumpridas no mês': +s.feitas_mes, 'Saldo do mês': +(+s.saldo_mes).toFixed(2), 'Saldo mês passado': +(+s.saldo_mes_ant).toFixed(2) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lista.map(linha)), 'Todos');
  const porSetor = {}; lista.forEach(s => (porSetor[nomeSetor(s.setor_id)] = porSetor[nomeSetor(s.setor_id)] || []).push(s));
  const usados = new Set(['Todos']);
  Object.keys(porSetor).sort().forEach(n => {
    let nome = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31); let i = 2; while (usados.has(nome)) nome = nome.slice(0, 28) + ' ' + i++;
    usados.add(nome); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porSetor[n].map(linha)), nome);
  });
  XLSX.writeFile(wb, `atividade-educativa-${isoDia(new Date())}.xlsx`);
}

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

// ---------- Acessos: líderes e NAF ----------
VIEWS.acessos = async () => {
  const { contas } = await adminFn('listar_contas');
  const ms = (sel = []) => `<select name="setores" multiple size="8" style="height:auto">${setoresOrdenados().map(s => `<option value="${s.id}" ${sel.includes(s.id) ? 'selected' : ''}>${esc(nomeSetor(s.id))}</option>`).join('')}</select>`;
  document.getElementById('main').innerHTML = `
  <div class="card"><h2>Novo acesso de líder ou NAF</h2>
    <form id="fl"><div class="fields">
      <div><label>Nome</label><input name="nome" required></div>
      <div><label>E-mail</label><input name="email" type="email" required></div>
      <div><label>Senha inicial</label><input name="senha" value="${senhaSugerida()}" required minlength="8"></div>
      <div><label>Papel</label><select name="papel"><option value="lider">Líder de setor</option><option value="naf">NAF (vê tudo)</option></select></div>
      <div class="full"><label>Setores que lidera <span class="muted">(Ctrl+clique para vários; subsetores entram junto)</span></label>${ms()}</div>
    </div><button class="btn primary block">Criar acesso</button></form>
    <div class="muted small" style="margin-top:8px">Passe o e-mail e a senha inicial para a pessoa. No primeiro acesso ela cria a própria senha.</div></div>
  <div class="card scroll"><h2>Contas</h2><table><thead><tr><th>Nome</th><th>Papel</th><th class="hide-m">Setores</th><th class="hide-m">Último acesso</th><th></th></tr></thead><tbody>
    ${contas.map(c => `<tr><td>${esc(c.nome)}<div class="muted small">${esc(c.email)}</div></td>
      <td><span class="tag">${c.papel.toUpperCase()}</span> ${c.ativo ? '' : '<span class="tag bad">desativado</span>'}</td>
      <td class="hide-m small">${c.papel === 'naf' ? 'Todos' : c.setores.map(id => esc(nomeSetor(id))).join(', ') || '<span class="tag warn">nenhum</span>'}</td>
      <td class="hide-m small">${c.ultimo_acesso ? dataHora(c.ultimo_acesso) : '—'}</td>
      <td><div class="row">${c.papel === 'lider' ? `<button class="btn sm" data-es="${c.user_id}">Setores</button>` : ''}
        <button class="btn sm" data-rs="${c.user_id}">Resetar senha</button>
        ${c.user_id === S.perfil.user_id ? '' : `<button class="btn sm" data-at="${c.user_id}" data-v="${c.ativo ? 0 : 1}">${c.ativo ? 'Desativar' : 'Reativar'}</button>`}</div></td></tr>`).join('')}
  </tbody></table></div>`;
  document.getElementById('fl').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const setores = Array.from(f.setores.selectedOptions, o => +o.value);
    if (f.papel.value === 'lider' && !setores.length) return toast('Escolha ao menos um setor.', true);
    await adminFn('criar_lider', { nome: f.nome.value, email: f.email.value, senha: f.senha.value, papel: f.papel.value, setores: f.papel.value === 'naf' ? [0] : setores });
    toast(`Acesso criado para ${f.email.value}. Senha inicial: ${f.senha.value}`); VIEWS.acessos();
  };
  document.querySelectorAll('[data-rs]').forEach(b => b.onclick = async () => {
    const s = prompt('Nova senha inicial (mínimo 8 caracteres):', senhaSugerida()); if (!s) return;
    await adminFn('resetar_senha', { user_id: b.dataset.rs, senha: s }); toast(`Senha resetada. Nova senha inicial: ${s}`);
  });
  document.querySelectorAll('[data-at]').forEach(b => b.onclick = async () => {
    await adminFn('definir_ativo', { user_id: b.dataset.at, ativo: b.dataset.v === '1' }); toast('Conta atualizada.'); VIEWS.acessos();
  });
  document.querySelectorAll('[data-es]').forEach(b => b.onclick = () => {
    const c = contas.find(x => x.user_id === b.dataset.es);
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="drawer"><button class="btn sm close" id="x">Fechar</button><h2>Setores de ${esc(c.nome)}</h2>
      <form id="fe"><label>Ctrl+clique para marcar vários</label>${ms(c.setores).replace('size="8"', 'size="16"')}<button class="btn primary block">Salvar</button></form></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#x').onclick = () => ov.remove(); ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.querySelector('#fe').onsubmit = async e => {
      e.preventDefault(); const novos = Array.from(e.target.setores.selectedOptions, o => +o.value);
      const tirar = c.setores.filter(s => !novos.includes(s)), por = novos.filter(s => !c.setores.includes(s));
      if (tirar.length) await q(sb.from('lideres_setor').delete().eq('user_id', c.user_id).in('setor_id', tirar));
      if (por.length) await q(sb.from('lideres_setor').insert(por.map(s => ({ user_id: c.user_id, setor_id: s }))));
      toast('Setores atualizados.'); ov.remove(); VIEWS.acessos();
    };
  });
};

// ---------- Aluno: meu saldo ----------
VIEWS.meu = async () => {
  const [s] = await q(sb.from('v_saldos').select('*'));
  if (!s) { document.getElementById('main').innerHTML = '<div class="card">Seu cadastro não está ativo. Procure o NAF.</div>'; return; }
  S.meuAlunoId = s.aluno_id;
  const setor = S.setores.find(x => x.id === s.setor_id) || {};
  const peds = await q(sb.from('pedidos').select('*').order('criado_em', { ascending: false }).limit(10));
  const st = { aguardando: ['Aguardando', 'warn'], aprovado: ['Aprovado', 'ok'], recusado: ['Recusado', 'bad'] };
  document.getElementById('main').innerHTML = `
  ${setor.modo_ponto === 'aluno' && !setor.turno_fixo_horas ? '<div class="card"><button class="btn primary block" style="margin:0" id="bater">Registrar presença agora</button></div>' : ''}
  <div id="calbox"></div>
  <div class="split">
    <div class="card"><div class="row"><h2 class="grow">Meus pedidos de ajuste</h2>${setor.turno_fixo_horas ? '' : '<button class="btn sm primary" id="nped">+ Pedir ajuste</button>'}</div>
      ${setor.turno_fixo_horas ? '<div class="muted small">Neste setor, os ajustes são feitos diretamente pelo líder.</div>' : ''}
      ${peds.map(p => `<div class="pend"><span class="tag ${st[p.status][1]}">${st[p.status][0]}</span><div class="grow small">
        ${p.tipo_alvo === 'entrada' ? 'Entrada' : 'Saída'} em ${new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR')} às ${p.horario.slice(0, 5)}
        <div class="muted">${esc(p.motivo)}${p.resposta ? ` · Resposta: ${esc(p.resposta)}` : ''}</div></div></div>`).join('') || '<div class="muted small" style="margin-top:8px">Nenhum pedido.</div>'}</div>
    <div class="card"><h2>PIN do quiosque</h2><div class="muted small">Usado para registrar presença no computador do setor.</div>
      <div class="row" style="margin-top:8px"><input id="pin" class="grow" type="password" inputmode="numeric" maxlength="6" placeholder="4 a 6 números"><button class="btn" id="pbt">Salvar PIN</button></div>
      <hr><h2>Trocar senha</h2><div class="row"><input id="ns" class="grow" type="password" placeholder="Nova senha (mín. 8)"><button class="btn" id="nsb">Trocar</button></div></div>
  </div>`;
  calendario(document.getElementById('calbox'), s.aluno_id, false);
  const b = document.getElementById('bater');
  if (b) b.onclick = async () => { b.disabled = true; const r = await q(sb.rpc('bater_ponto', { p_aluno: s.aluno_id })); toast(`${r.tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada às ${hora(r.ts)}.`); VIEWS.meu(); };
  const np = document.getElementById('nped'); if (np) np.onclick = () => pedirAjuste(null, () => VIEWS.meu());
  document.getElementById('pbt').onclick = async () => { await q(sb.rpc('definir_pin', { p_aluno: s.aluno_id, p_pin: document.getElementById('pin').value })); toast('PIN salvo.'); document.getElementById('pin').value = ''; };
  document.getElementById('nsb').onclick = async () => {
    const p = document.getElementById('ns').value; if (p.length < 8) return toast('A senha precisa de pelo menos 8 caracteres.', true);
    await q(sb.auth.updateUser({ password: p })); toast('Senha trocada.'); document.getElementById('ns').value = '';
  };
};

sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.perfil) telaLogin(); });
iniciar();
