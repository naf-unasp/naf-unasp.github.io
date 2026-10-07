-- =====================================================================
-- Migração 004 — funções do líder iguais ao app da igreja:
-- dias combinados + escala alternada, pedidos de ajuste, calendário
-- =====================================================================

-- Escala alternada (Semana 1 = dias_trabalho, Semana 2 = dias_trabalho_b)
alter table alunos add column escala_alternada boolean not null default false;
alter table alunos add column dias_trabalho_b text[];
alter table alunos add column dias_ref_a date;  -- segunda-feira da "Semana 1"
grant select (escala_alternada, dias_trabalho_b, dias_ref_a),
      insert (escala_alternada, dias_trabalho_b, dias_ref_a),
      update (escala_alternada, dias_trabalho_b, dias_ref_a) on alunos to authenticated;

-- Líder (ou NAF) ajusta só os dias combinados e a escala
create or replace function definir_dias(p_aluno uuid, p_dias text[], p_alternada boolean default false,
                                        p_dias_b text[] default null, p_ref date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_setor bigint;
begin
  select setor_id into v_setor from alunos where id = p_aluno;
  if not found then raise exception 'Aluno não encontrado'; end if;
  if not (is_naf() or lidera_setor(v_setor)) then raise exception 'Sem permissão'; end if;
  if p_alternada and p_ref is null then raise exception 'Informe a segunda-feira da Semana 1'; end if;
  update alunos set dias_trabalho = p_dias, escala_alternada = coalesce(p_alternada, false),
         dias_trabalho_b = case when p_alternada then p_dias_b end,
         dias_ref_a = case when p_alternada then date_trunc('week', p_ref)::date end
  where id = p_aluno;
end $$;

-- Registros podem nascer de um pedido de ajuste aprovado
alter table registros drop constraint registros_origem_check;
alter table registros add constraint registros_origem_check check (origem in ('lider','aluno','quiosque','naf','ajuste'));

-- Pedidos de ajuste
create table pedidos (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null references alunos(id) on delete cascade,
  setor_id      bigint not null references setores(id),
  data          date not null,
  tipo_alvo     tipo_reg_t not null,
  horario       time not null,
  motivo        text not null,
  status        text not null default 'aguardando' check (status in ('aguardando','aprovado','recusado')),
  resposta      text,
  criado_em     timestamptz not null default now(),
  resolvido_por uuid,
  resolvido_em  timestamptz
);
create index on pedidos (setor_id, status);
create index on pedidos (aluno_id);
alter table pedidos enable row level security;
revoke all on pedidos from anon, authenticated;
grant select on pedidos to authenticated;
grant all on pedidos to service_role;
create policy ped_ler on pedidos for select to authenticated
  using (is_naf() or lidera_setor(setor_id) or aluno_id = meu_aluno_id());
create trigger aud_pedidos after insert or update or delete on pedidos for each row execute function fn_auditoria();

-- Aluno pede ajuste (não vale para setores de turno fixo)
create or replace function pedir_ajuste(p_data date, p_tipo tipo_reg_t, p_horario time, p_motivo text)
returns pedidos language plpgsql security definer set search_path = public as $$
declare a alunos; s setores; r pedidos;
begin
  select * into a from alunos where id = meu_aluno_id() and ativo;
  if not found then raise exception 'Cadastro não encontrado'; end if;
  select * into s from setores where id = a.setor_id;
  if s.turno_fixo_horas is not null then raise exception 'Neste setor os ajustes são feitos pelo líder'; end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Não é possível pedir ajuste para uma data futura'; end if;
  if p_data < (now() at time zone 'America/Sao_Paulo')::date - 31 then raise exception 'Só é possível pedir ajuste dos últimos 31 dias'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Explique o motivo do ajuste'; end if;
  if (select count(*) from pedidos where aluno_id = a.id and status = 'aguardando') >= 10 then
    raise exception 'Você já tem muitos pedidos aguardando. Aguarde a resposta do líder.';
  end if;
  insert into pedidos (aluno_id, setor_id, data, tipo_alvo, horario, motivo)
  values (a.id, a.setor_id, p_data, p_tipo, p_horario, trim(p_motivo)) returning * into r;
  return r;
end $$;

-- Líder do setor (ou NAF) aprova/recusa; aprovado vira registro
create or replace function resolver_pedido(p_id bigint, p_aprovar boolean, p_resposta text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p pedidos;
begin
  select * into p from pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if not (is_naf() or lidera_setor(p.setor_id)) then raise exception 'Sem permissão'; end if;
  if p.status <> 'aguardando' then raise exception 'Este pedido já foi respondido'; end if;
  if not p_aprovar and coalesce(trim(p_resposta), '') = '' then raise exception 'Informe o motivo da recusa'; end if;
  update pedidos set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         resposta = nullif(trim(p_resposta), ''), resolvido_por = auth.uid(), resolvido_em = now()
  where id = p_id;
  if p_aprovar then
    insert into registros (aluno_id, setor_id, tipo, ts, origem)
    values (p.aluno_id, p.setor_id, p.tipo_alvo, (p.data + p.horario) at time zone 'America/Sao_Paulo', 'ajuste');
  end if;
end $$;

revoke execute on function definir_dias(uuid, text[], boolean, text[], date), pedir_ajuste(date, tipo_reg_t, time, text),
  resolver_pedido(bigint, boolean, text) from public, anon;
grant execute on function definir_dias(uuid, text[], boolean, text[], date), pedir_ajuste(date, tipo_reg_t, time, text),
  resolver_pedido(bigint, boolean, text) to authenticated, service_role;

select 'migracao 004 ok' as status;
