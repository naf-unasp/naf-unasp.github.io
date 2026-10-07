-- =====================================================================
-- Migração 005 — link de convite para o aluno criar o próprio acesso
-- O link leva só um código aleatório (o banco guarda apenas o hash).
-- Vale 7 dias, uma única vez. Gerar um novo invalida o anterior.
-- =====================================================================
create table convites (
  id          bigint generated always as identity primary key,
  aluno_id    uuid not null references alunos(id) on delete cascade,
  token_hash  text not null unique,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '7 days',
  usado_em    timestamptz
);
create index on convites (aluno_id);
alter table convites enable row level security;   -- sem políticas: só o servidor lê
revoke all on convites from anon, authenticated;
grant all on convites to service_role;
create trigger aud_convites after insert or update or delete on convites for each row execute function fn_auditoria();

-- NAF ou líder do setor gera o link. Devolve null se o aluno já tem acesso.
create or replace function gerar_convite(p_aluno uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare a alunos; v_token text;
begin
  select * into a from alunos where id = p_aluno;
  if not found then raise exception 'Aluno não encontrado'; end if;
  if not (is_naf() or lidera_setor(a.setor_id)) then raise exception 'Sem permissão'; end if;
  if not a.ativo then raise exception 'Aluno inativo'; end if;
  if exists (select 1 from perfis where aluno_id = a.id) then return null; end if;
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  delete from convites where aluno_id = a.id and usado_em is null;
  insert into convites (aluno_id, token_hash) values (a.id, encode(digest(v_token, 'sha256'), 'hex'));
  return v_token;
end $$;
revoke execute on function gerar_convite(uuid) from public, anon;
grant execute on function gerar_convite(uuid) to authenticated, service_role;

select 'migracao 005 ok' as status;
