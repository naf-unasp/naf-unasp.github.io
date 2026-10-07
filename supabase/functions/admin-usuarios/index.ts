// Edge Function: admin-usuarios
// Só o NAF pode chamar. Cria logins de alunos e líderes, reseta senhas e ativa/desativa contas.
// A chave de serviço fica só no servidor do Supabase (variável SUPABASE_SERVICE_ROLE_KEY).
import { createClient } from 'npm:@supabase/supabase-js@2';

const RA_DOMINIO = 'aluno.te-unasp.app';
const ORIGENS = ['https://naf-unasp.github.io'];

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ORIGENS.includes(origin) ? origin : ORIGENS[0],
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  const resp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return resp({ erro: 'Método não permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // 1) Quem está chamando? Precisa ser NAF ativo.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return resp({ erro: 'Sessão inválida' }, 401);
  const { data: eu_perfil } = await admin.from('perfis').select('papel, ativo').eq('user_id', u.user.id).maybeSingle();
  if (!eu_perfil || eu_perfil.papel !== 'naf' || !eu_perfil.ativo) return resp({ erro: 'Só o NAF pode gerenciar acessos' }, 403);
  let aal = 'aal1';
  try { aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch { /* token malformado */ }
  if (aal !== 'aal2') return resp({ erro: 'Confirme o login em dois passos para gerenciar acessos' }, 403);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return resp({ erro: 'Corpo inválido' }, 400); }
  const senhaOk = (s: unknown) => typeof s === 'string' && s.length >= 8 && s.length <= 72;
  const audit = (operacao: string, registro_id: string, depois: unknown) =>
    admin.from('auditoria').insert({ tabela: 'acessos', operacao, registro_id, usuario: u.user.id, depois });

  try {
    switch (b.acao) {
      // Cria (ou recria) o login de um aluno: e-mail interno baseado no RA
      case 'criar_login_aluno': {
        if (!senhaOk(b.senha)) return resp({ erro: 'A senha inicial precisa ter de 8 a 72 caracteres' }, 400);
        const { data: a } = await admin.from('alunos').select('id, ra, nome, ativo').eq('id', b.aluno_id).maybeSingle();
        if (!a) return resp({ erro: 'Aluno não encontrado' }, 404);
        const { data: ja } = await admin.from('perfis').select('user_id').eq('aluno_id', a.id).maybeSingle();
        if (ja) return resp({ erro: 'Este aluno já tem acesso. Use "Resetar senha".' }, 409);
        const email = `ra-${a.ra.replace(/\D/g, '')}@${RA_DOMINIO}`;
        const { data: c, error } = await admin.auth.admin.createUser({ email, password: b.senha, email_confirm: true });
        if (error) return resp({ erro: error.message }, 400);
        const { error: ep } = await admin.from('perfis').insert({ user_id: c.user.id, papel: 'aluno', nome: a.nome, aluno_id: a.id, troca_senha: true });
        if (ep) { await admin.auth.admin.deleteUser(c.user.id); return resp({ erro: ep.message }, 400); }
        await audit('CRIAR_LOGIN_ALUNO', c.user.id, { aluno_id: a.id, ra: a.ra });
        return resp({ ok: true, login: a.ra });
      }

      // Cria o login de um líder (e-mail real) e vincula aos setores
      case 'criar_lider': {
        const email = String(b.email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp({ erro: 'E-mail inválido' }, 400);
        if (!String(b.nome || '').trim()) return resp({ erro: 'Informe o nome' }, 400);
        if (!senhaOk(b.senha)) return resp({ erro: 'A senha inicial precisa ter de 8 a 72 caracteres' }, 400);
        const setores: number[] = Array.isArray(b.setores) ? b.setores.map(Number).filter(Boolean) : [];
        const papel = b.papel === 'naf' ? 'naf' : 'lider';
        if (papel === 'lider' && !setores.length) return resp({ erro: 'Escolha ao menos um setor' }, 400);
        const { data: c, error } = await admin.auth.admin.createUser({ email, password: b.senha, email_confirm: true });
        if (error) return resp({ erro: error.message.includes('already') ? 'Já existe uma conta com este e-mail' : error.message }, 400);
        const { error: ep } = await admin.from('perfis').insert({ user_id: c.user.id, papel, nome: String(b.nome).trim(), troca_senha: true });
        if (ep) { await admin.auth.admin.deleteUser(c.user.id); return resp({ erro: ep.message }, 400); }
        if (papel === 'lider') await admin.from('lideres_setor').insert(setores.map((s) => ({ user_id: c.user.id, setor_id: s })));
        await audit('CRIAR_LOGIN_' + papel.toUpperCase(), c.user.id, { email, setores });
        return resp({ ok: true });
      }

      // Reseta a senha de qualquer conta (aluno pelo aluno_id ou usuário pelo user_id)
      case 'resetar_senha': {
        if (!senhaOk(b.senha)) return resp({ erro: 'A nova senha precisa ter de 8 a 72 caracteres' }, 400);
        let uid = b.user_id as string | undefined;
        if (!uid && b.aluno_id) uid = (await admin.from('perfis').select('user_id').eq('aluno_id', b.aluno_id).maybeSingle()).data?.user_id;
        if (!uid) return resp({ erro: 'Conta não encontrada' }, 404);
        const { error } = await admin.auth.admin.updateUserById(uid, { password: b.senha });
        if (error) return resp({ erro: error.message }, 400);
        await admin.from('perfis').update({ troca_senha: true }).eq('user_id', uid);
        await admin.auth.admin.signOut(uid).catch(() => {});
        await audit('RESETAR_SENHA', uid, {});
        return resp({ ok: true });
      }

      // Ativa ou desativa uma conta (desativada não consegue entrar)
      case 'definir_ativo': {
        if (!b.user_id) return resp({ erro: 'Conta não informada' }, 400);
        if (b.user_id === u.user.id) return resp({ erro: 'Você não pode desativar a própria conta' }, 400);
        const ativo = !!b.ativo;
        await admin.from('perfis').update({ ativo }).eq('user_id', b.user_id);
        await admin.auth.admin.updateUserById(b.user_id, { ban_duration: ativo ? 'none' : '876000h' });
        await audit(ativo ? 'ATIVAR_CONTA' : 'DESATIVAR_CONTA', b.user_id, {});
        return resp({ ok: true });
      }

      // Lista contas (NAF e líderes) com e-mail, para a tela de usuários
      case 'listar_contas': {
        const { data: perfis } = await admin.from('perfis').select('user_id, papel, nome, ativo').neq('papel', 'aluno').order('nome');
        const { data: lid } = await admin.from('lideres_setor').select('user_id, setor_id');
        const out = [];
        for (const p of perfis || []) {
          const { data: au } = await admin.auth.admin.getUserById(p.user_id);
          const { data: fs } = await admin.auth.admin.mfa.listFactors({ userId: p.user_id });
          out.push({ ...p, email: au?.user?.email, ultimo_acesso: au?.user?.last_sign_in_at,
            mfa: (fs?.factors || []).some((f: any) => f.status === 'verified'),
            setores: (lid || []).filter((l) => l.user_id === p.user_id).map((l) => l.setor_id) });
        }
        return resp({ ok: true, contas: out });
      }

      // Remove o login em dois passos de alguém que perdeu o celular (cadastra de novo no próximo login)
      case 'resetar_mfa': {
        if (!b.user_id) return resp({ erro: 'Conta não informada' }, 400);
        const { data: fs, error } = await admin.auth.admin.mfa.listFactors({ userId: b.user_id });
        if (error) return resp({ erro: error.message }, 400);
        for (const f of fs?.factors || []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: b.user_id });
        await admin.auth.admin.signOut(b.user_id).catch(() => {});
        await audit('RESETAR_MFA', b.user_id, {});
        return resp({ ok: true });
      }

      // Quais alunos já têm login
      case 'alunos_com_login': {
        const { data } = await admin.from('perfis').select('aluno_id').eq('papel', 'aluno');
        return resp({ ok: true, ids: (data || []).map((d) => d.aluno_id) });
      }

      default:
        return resp({ erro: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    return resp({ erro: (e as Error).message }, 500);
  }
});
