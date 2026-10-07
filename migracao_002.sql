-- =====================================================================
-- Migração 002 — subsetores, horas individuais e pendências do NAF
-- =====================================================================

-- Subsetores: um setor pode pertencer a outro (ex.: Igreja → Sonoplastia)
alter table setores add column setor_pai_id bigint references setores(id) on delete restrict;
alter table setores add constraint setor_nao_e_pai_de_si check (setor_pai_id is distinct from id);
create index on setores (setor_pai_id);

-- Horas individuais: quando o aluno tem carga diferente do plano
alter table alunos add column horas_semana numeric(5,2) check (horas_semana >= 0);
grant select (horas_semana), insert (horas_semana), update (horas_semana) on alunos to authenticated;

-- Líder de um setor também lidera os subsetores dele
create or replace function lidera_setor(p_setor bigint) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive cadeia as (
    select id, setor_pai_id from setores where id = p_setor
    union all
    select s.id, s.setor_pai_id from setores s join cadeia c on s.id = c.setor_pai_id
  )
  select exists (
    select 1 from lideres_setor l join perfis p on p.user_id = l.user_id
    where l.user_id = auth.uid() and p.ativo and l.setor_id in (select id from cadeia)
  )
$$;

-- Pendências que o NAF precisa resolver (aparecem na tela principal)
create table pendencias (
  id            bigint generated always as identity primary key,
  tipo          text not null check (tipo in ('ra_duplicado','horas_diferentes','sem_plano','outro')),
  aluno_id      uuid references alunos(id) on delete cascade,
  ra            text,
  descricao     text not null,
  dados         jsonb,
  resolvida     boolean not null default false,
  resolucao     text,
  resolvida_por uuid,
  resolvida_em  timestamptz,
  criado_em     timestamptz not null default now()
);
create index on pendencias (resolvida, tipo);
alter table pendencias enable row level security;
revoke all on pendencias from anon, authenticated;
grant select on pendencias to authenticated;
create policy pend_ler on pendencias for select to authenticated using (is_naf());
create trigger aud_pendencias after insert or update or delete on pendencias for each row execute function fn_auditoria();

create or replace function resolver_pendencia(p_id bigint, p_resolucao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_naf() then raise exception 'Só o NAF resolve pendências'; end if;
  if coalesce(trim(p_resolucao), '') = '' then raise exception 'Descreva como foi resolvido'; end if;
  update pendencias set resolvida = true, resolucao = p_resolucao,
         resolvida_por = auth.uid(), resolvida_em = now()
  where id = p_id and not resolvida;
end $$;
revoke execute on function resolver_pendencia(bigint, text) from public, anon;
grant execute on function resolver_pendencia(bigint, text) to authenticated;

-- Saldos passam a usar a hora individual quando existir
create or replace view v_saldos with (security_invoker = true) as
with ref as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as ini_mes
), base as (
  select a.id as aluno_id, a.ra, a.nome, a.setor_id, s.nome as setor, a.plano, p.nivel,
         coalesce(a.horas_semana, p.horas_semana, 0) as horas_semana, a.inicio,
         ref.hoje, ref.ini_mes, (ref.ini_mes - interval '1 month')::date as ini_ant
  from alunos a
  cross join ref
  left join setores s on s.id = a.setor_id
  left join planos  p on p.codigo = a.plano
  where a.ativo
), calc as (
  select b.*,
    round(b.horas_semana / 7 * greatest(0, b.hoje - greatest(b.ini_mes, b.inicio) + 1), 2) as meta_mes,
    coalesce((select sum(d.horas) from v_horas_dia d
              where d.aluno_id = b.aluno_id and d.dia between b.ini_mes and b.hoje), 0) as feitas_mes,
    round(b.horas_semana / 7 * greatest(0, (b.ini_mes - 1) - greatest(b.ini_ant, b.inicio) + 1), 2) as meta_mes_ant,
    coalesce((select sum(d.horas) from v_horas_dia d
              where d.aluno_id = b.aluno_id and d.dia between b.ini_ant and b.ini_mes - 1), 0) as feitas_mes_ant,
    (select count(*) from v_horas_dia d
      where d.aluno_id = b.aluno_id and d.sem_par and d.dia between b.ini_ant and b.hoje) as dias_sem_par
  from base b
)
select aluno_id, ra, nome, setor_id, setor, plano, nivel, horas_semana,
       meta_mes, feitas_mes, feitas_mes - meta_mes as saldo_mes,
       meta_mes_ant, feitas_mes_ant, feitas_mes_ant - meta_mes_ant as saldo_mes_ant,
       dias_sem_par
from calc;
revoke all on v_saldos from anon, authenticated;
grant select on v_saldos to authenticated;
