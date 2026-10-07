// Edge Function: convite (pública)
// O aluno abre o link com ?convite=<código>. Esta função:
//   ver   → devolve nome e RA do aluno do convite (se válido)
//   criar → cria o login do aluno com a senha escolhida e marca o convite como usado
// O código tem 192 bits aleatórios; o banco guarda só o hash SHA-256.
import { createClient } from 'npm:@supabase/supabase-js@2';

const RA_DOMINIO = 'aluno.te-unasp.app';
const ORIGENS = ['https://naf-unasp.github.io'];

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ORIGENS.includes(origin) ? origin : ORIGENS[0],
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  const resp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return resp({ erro: 'Método não permitido' }, 405);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return resp({ erro: 'Pedido inválido' }, 400); }
  const token = String(b.token || '');
  if (!/^[A-Za-z0-9_-]{30,40}$/.test(token)) return resp({ erro: 'Link inválido' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: c } = await admin.from('convites').select('id, aluno_id, expira_em, usado_em').eq('token_hash', await sha256(token)).maybeSingle();
  const invalido = 'Este link não é válido ou já expirou. Peça um novo ao seu líder ou ao NAF.';
  if (!c || c.usado_em || new Date(c.expira_em) < new Date()) return resp({ erro: invalido }, 404);
  const { data: a } = await admin.from('alunos').select('id, nome, ra, ativo').eq('id', c.aluno_id).maybeSingle();
  if (!a || !a.ativo) return resp({ erro: invalido }, 404);
  const { data: ja } = await admin.from('perfis').select('user_id').eq('aluno_id', a.id).maybeSingle();
  if (ja) return resp({ erro: 'Você já tem acesso. Entre com seu RA e senha.' }, 409);

  if (b.acao === 'ver') return resp({ ok: true, nome: a.nome, ra: a.ra });

  if (b.acao === 'criar') {
    const senha = String(b.senha || '');
    if (senha.length < 8 || senha.length > 72) return resp({ erro: 'A senha precisa ter de 8 a 72 caracteres' }, 400);
    // marca o convite como usado primeiro (evita uso duplo simultâneo)
    const { data: marcado } = await admin.from('convites').update({ usado_em: new Date().toISOString() })
      .eq('id', c.id).is('usado_em', null).select('id');
    if (!marcado?.length) return resp({ erro: invalido }, 409);
    const email = `ra-${a.ra.replace(/\D/g, '')}@${RA_DOMINIO}`;
    const { data: u, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (error) {
      await admin.from('convites').update({ usado_em: null }).eq('id', c.id);
      return resp({ erro: error.message.includes('already') ? 'Já existe um acesso para este RA. Procure o NAF.' : error.message }, 400);
    }
    const { error: ep } = await admin.from('perfis').insert({ user_id: u.user.id, papel: 'aluno', nome: a.nome, aluno_id: a.id, troca_senha: false });
    if (ep) {
      await admin.auth.admin.deleteUser(u.user.id);
      await admin.from('convites').update({ usado_em: null }).eq('id', c.id);
      return resp({ erro: 'Não foi possível criar o acesso. Tente novamente.' }, 500);
    }
    await admin.from('auditoria').insert({ tabela: 'acessos', operacao: 'CRIAR_LOGIN_POR_CONVITE', registro_id: u.user.id, depois: { aluno_id: a.id, ra: a.ra } });
    return resp({ ok: true, ra: a.ra });
  }
  return resp({ erro: 'Ação desconhecida' }, 400);
});
