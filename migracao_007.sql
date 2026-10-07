-- =====================================================================
-- Migração 007
-- (a) Login em dois passos (MFA) obrigatório para NAF e líderes:
--     sem o segundo passo (sessão aal2), o banco não reconhece o papel.
-- (b) Retenção: dados de aluno desativado há mais de 5 anos são apagados
--     automaticamente (todo dia 1º, às 3h).
-- =====================================================================

-- (a) MFA ----------------------------------------------------------------
create or replace function sessao_mfa() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create or replace function is_naf() returns boolean
language sql stable security definer set search_path = public as $$
  select sessao_mfa()
     and coalesce((select papel = 'naf' from perfis where user_id = auth.uid() and ativo), false)
$$;

create or replace function lidera_setor(p_setor bigint) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive cadeia as (
    select id, setor_pai_id from setores where id = p_setor
    union all
    select s.id, s.setor_pai_id from setores s join cadeia c on s.id = c.setor_pai_id
  )
  select sessao_mfa() and exists (
    select 1 from lideres_setor l join perfis p on p.user_id = l.user_id
    where l.user_id = auth.uid() and p.ativo and l.setor_id in (select id from cadeia)
  )
$$;

revoke execute on function sessao_mfa() from public, anon;
grant execute on function sessao_mfa() to authenticated, service_role;

-- (b) Retenção -----------------------------------------------------------
alter table alunos add column desativado_em timestamptz;
grant select (desativado_em) on alunos to authenticated;
update alunos set desativado_em = now() where not ativo and desativado_em is null;

create or replace function fn_marca_desativacao() returns trigger language plpgsql as $$
begin
  if new.ativo then new.desativado_em := null;
  elsif tg_op = 'INSERT' or old.ativo then new.desativado_em := now();
  end if;
  return new;
end $$;
drop trigger if exists alunos_desativacao on alunos;
create trigger alunos_desativacao before insert or update of ativo on alunos
  for each row execute function fn_marca_desativacao();

-- A auditoria não copia os dados durante o expurgo (senão os dados apagados
-- reapareceriam dentro da própria auditoria).
create or replace function fn_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_antes  jsonb;
  v_depois jsonb;
begin
  if current_setting('app.expurgo', true) = 'on' then return coalesce(new, old); end if;
  v_antes  := case when tg_op <> 'INSERT' then to_jsonb(old) - 'pin_hash' end;
  v_depois := case when tg_op <> 'DELETE' then to_jsonb(new) - 'pin_hash' end;
  insert into auditoria (tabela, operacao, registro_id, usuario, antes, depois)
  values (tg_table_name, tg_op,
          coalesce(v_depois->>'id', v_antes->>'id', v_depois->>'user_id', v_antes->>'user_id'),
          auth.uid(), v_antes, v_depois);
  return coalesce(new, old);
end $$;

create or replace function expurgar_dados_antigos(p_anos int default 5)
returns int language plpgsql security definer set search_path = public, auth as $$
declare v_ids uuid[]; v_n int;
begin
  select array_agg(id) into v_ids from alunos
  where not ativo and desativado_em < now() - make_interval(years => p_anos);
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return 0; end if;

  perform set_config('app.expurgo', 'on', true);
  -- logins dos alunos (apaga também o perfil)
  delete from auth.users where id in (select user_id from perfis where aluno_id = any(v_ids));
  -- histórico de auditoria que contém dados desses alunos
  delete from auditoria
   where registro_id = any(select unnest(v_ids)::text)
      or (antes  ->> 'aluno_id')::uuid = any(v_ids)
      or (depois ->> 'aluno_id')::uuid = any(v_ids);
  -- o aluno (registros, pedidos, convites, transferências e pendências vão junto)
  delete from alunos where id = any(v_ids);
  perform set_config('app.expurgo', 'off', true);

  insert into auditoria (tabela, operacao, registro_id, depois)
  values ('alunos', 'EXPURGO_RETENCAO', null, jsonb_build_object('alunos_apagados', v_n, 'anos', p_anos));
  return v_n;
end $$;
revoke execute on function expurgar_dados_antigos(int) from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('expurgo-retencao-5-anos', '0 3 1 * *', $$select public.expurgar_dados_antigos(5)$$);

select 'migracao 007 ok' as status;
