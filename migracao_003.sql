-- Migração 003 — troca de senha obrigatória no primeiro acesso
create or replace function marcar_senha_trocada()
returns void language sql security definer set search_path = public as $$
  update perfis set troca_senha = false where user_id = auth.uid();
$$;
revoke execute on function marcar_senha_trocada() from public, anon;
grant execute on function marcar_senha_trocada() to authenticated;
select 'ok' as status;
