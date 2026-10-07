-- =====================================================================
-- Trabalho Educativo UNASP — Plataforma de Pontos (Supabase / Postgres)
-- Versão 1 — 06/10/2026
--
-- Rodar inteiro no Supabase: SQL Editor → New query → colar → Run.
-- Toda a segurança está aqui (RLS + funções). O site (GitHub Pages)
-- só usa a chave pública "anon"; sem login, nada é lido nem gravado.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type papel_t      as enum ('naf', 'lider', 'aluno');
create type modo_ponto_t as enum ('lider', 'aluno', 'quiosque');
  -- lider    = o líder bate o ponto pelos alunos
  -- aluno    = cada aluno bate o próprio ponto no seu login
  -- quiosque = o líder deixa um computador logado e cada aluno bate com RA + PIN
create type tipo_reg_t   as enum ('entrada', 'saida');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table setores (
  id               bigint generated always as identity primary key,
  nome             text not null unique,
  modo_ponto       modo_ponto_t not null default 'lider',
  turno_fixo_horas numeric(4,2),          -- ex.: 4 para Conservação (lança entrada+saída)
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

create table planos (
  codigo        text primary key,         -- ADPi, ADP1..ADP7, DPEBi, DPEB1..DPEB6
  nivel         text not null check (nivel in ('EM', 'FAC')),
  horas_semana  numeric(5,2) not null check (horas_semana >= 0),
  horas_mes     numeric(6,2) not null check (horas_mes >= 0),
  descricao     text
);

create table alunos (
  id                uuid primary key default gen_random_uuid(),
  ra                text not null unique,
  nome              text not null,
  nascimento        date,
  telefone          text,
  curso             text,
  semestre          text,
  plano             text references planos(codigo),
  setor_id          bigint references setores(id),
  plantao_setor_id  bigint references setores(id),
  inicio            date not null default current_date,  -- a meta conta a partir daqui
  dias_trabalho     text[],                              -- {seg,ter,...}
  observacao        text,
  ativo             boolean not null default true,
  pin_hash          text,                                -- PIN do quiosque (nunca exposto)
  pin_falhas        int not null default 0,
  pin_bloqueado_ate timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index on alunos (setor_id);

create table perfis (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  papel       papel_t not null,
  nome        text not null,
  aluno_id    uuid unique references alunos(id) on delete set null,
  ativo       boolean not null default true,
  troca_senha boolean not null default true,  -- força troca no 1º acesso
  criado_em   timestamptz not null default now(),
  check ((papel = 'aluno') = (aluno_id is not null))
);

create table lideres_setor (
  user_id  uuid   not null references perfis(user_id) on delete cascade,
  setor_id bigint not null references setores(id) on delete cascade,
  primary key (user_id, setor_id)
);
create index on lideres_setor (setor_id);

create table transferencias (
  id          bigint generated always as identity primary key,
  aluno_id    uuid not null references alunos(id) on delete cascade,
  de_setor    bigint references setores(id),
  para_setor  bigint not null references setores(id),
  motivo      text,
  feito_por   uuid default auth.uid(),
  em          timestamptz not null default now()
);

create table registros (
  id                  bigint generated always as identity primary key,
  aluno_id            uuid not null references alunos(id) on delete cascade,
  setor_id            bigint not null references setores(id),
  tipo                tipo_reg_t not null,
  ts                  timestamptz not null default now(),
  origem              text not null check (origem in ('lider','aluno','quiosque','naf')),
  registrado_por      uuid default auth.uid(),
  cancelado           boolean not null default false,
  motivo_cancelamento text,
  criado_em           timestamptz not null default now()
);
create index on registros (aluno_id, ts);
create index on registros (setor_id, ts);

create table auditoria (
  id          bigint generated always as identity primary key,
  tabela      text not null,
  operacao    text not null,
  registro_id text,
  usuario     uuid,
  antes       jsonb,
  depois      jsonb,
  em          timestamptz not null default now()
);
create index on auditoria (tabela, registro_id);

-- ---------------------------------------------------------------------
-- Funções auxiliares de permissão (security definer evita recursão no RLS)
-- ---------------------------------------------------------------------
create or replace function meu_papel() returns papel_t
language sql stable security definer set search_path = public as $$
  select papel from perfis where user_id = auth.uid() and ativo
$$;

create or replace function is_naf() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'naf' from perfis where user_id = auth.uid() and ativo), false)
$$;

create or replace function lidera_setor(p_setor bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lideres_setor l join perfis p on p.user_id = l.user_id
    where l.user_id = auth.uid() and l.setor_id = p_setor and p.ativo
  )
$$;

create or replace function meu_aluno_id() returns uuid
language sql stable security definer set search_path = public as $$
  select aluno_id from perfis where user_id = auth.uid() and ativo
$$;

-- ---------------------------------------------------------------------
-- Auditoria automática (quem mudou o quê e quando)
-- ---------------------------------------------------------------------
create or replace function fn_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_antes  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'pin_hash' end;
  v_depois jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'pin_hash' end;
begin
  insert into auditoria (tabela, operacao, registro_id, usuario, antes, depois)
  values (tg_table_name, tg_op,
          coalesce(v_depois->>'id', v_antes->>'id', v_depois->>'user_id', v_antes->>'user_id'),
          auth.uid(), v_antes, v_depois);
  return coalesce(new, old);
end $$;

create trigger aud_alunos        after insert or update or delete on alunos        for each row execute function fn_auditoria();
create trigger aud_registros     after insert or update or delete on registros     for each row execute function fn_auditoria();
create trigger aud_perfis        after insert or update or delete on perfis        for each row execute function fn_auditoria();
create trigger aud_lideres       after insert or update or delete on lideres_setor for each row execute function fn_auditoria();
create trigger aud_setores       after insert or update or delete on setores       for each row execute function fn_auditoria();
create trigger aud_planos        after insert or update or delete on planos        for each row execute function fn_auditoria();

create or replace function fn_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
create trigger alunos_atualizado before update on alunos for each row execute function fn_atualizado_em();

-- ---------------------------------------------------------------------
-- Permissões base: anon não acessa nada; acesso só via RLS
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;

grant select                         on setores, planos, perfis, lideres_setor, transferencias, registros, auditoria to authenticated;
grant insert, update, delete         on setores, planos, perfis, lideres_setor to authenticated;
-- alunos: pin_hash e controle do PIN nunca são legíveis pelo site
grant select (id, ra, nome, nascimento, telefone, curso, semestre, plano, setor_id, plantao_setor_id,
              inicio, dias_trabalho, observacao, ativo, criado_em, atualizado_em) on alunos to authenticated;
grant insert (ra, nome, nascimento, telefone, curso, semestre, plano, setor_id, plantao_setor_id,
              inicio, dias_trabalho, observacao, ativo) on alunos to authenticated;
grant update (ra, nome, nascimento, telefone, curso, semestre, plano, plantao_setor_id,
              inicio, dias_trabalho, observacao, ativo) on alunos to authenticated;
-- registros e transferências: só gravados pelas funções abaixo

alter table setores        enable row level security;
alter table planos         enable row level security;
alter table alunos         enable row level security;
alter table perfis         enable row level security;
alter table lideres_setor  enable row level security;
alter table transferencias enable row level security;
alter table registros      enable row level security;
alter table auditoria      enable row level security;

-- setores / planos: todos logados leem; só NAF altera
create policy setores_ler   on setores for select to authenticated using (true);
create policy setores_naf   on setores for all    to authenticated using (is_naf()) with check (is_naf());
create policy planos_ler    on planos  for select to authenticated using (true);
create policy planos_naf    on planos  for all    to authenticated using (is_naf()) with check (is_naf());

-- alunos: NAF tudo; líder só do(s) seu(s) setor(es); aluno só a si mesmo
create policy alunos_ler on alunos for select to authenticated
  using (is_naf() or lidera_setor(setor_id) or id = meu_aluno_id());
create policy alunos_naf_ins on alunos for insert to authenticated with check (is_naf());
create policy alunos_naf_upd on alunos for update to authenticated using (is_naf()) with check (is_naf());
create policy alunos_naf_del on alunos for delete to authenticated using (is_naf());

-- perfis / líderes
create policy perfis_ler on perfis for select to authenticated using (user_id = auth.uid() or is_naf());
create policy perfis_naf on perfis for all    to authenticated using (is_naf()) with check (is_naf());
create policy lideres_ler on lideres_setor for select to authenticated using (user_id = auth.uid() or is_naf() or lidera_setor(setor_id));
create policy lideres_naf on lideres_setor for all    to authenticated using (is_naf()) with check (is_naf());

-- transferências / registros: leitura conforme o papel
create policy transf_ler on transferencias for select to authenticated
  using (is_naf() or lidera_setor(para_setor) or lidera_setor(de_setor));
create policy reg_ler on registros for select to authenticated
  using (is_naf() or lidera_setor(setor_id) or aluno_id = meu_aluno_id());

-- auditoria: só NAF
create policy aud_ler on auditoria for select to authenticated using (is_naf());

-- ---------------------------------------------------------------------
-- Regras de ponto (únicas portas de gravação de registros)
-- ---------------------------------------------------------------------
create or replace function proximo_tipo(p_aluno uuid, p_ts timestamptz) returns tipo_reg_t
language sql stable security definer set search_path = public as $$
  select case when (
    select tipo from registros
    where aluno_id = p_aluno and not cancelado and ts <= p_ts
      and (ts at time zone 'America/Sao_Paulo')::date = (p_ts at time zone 'America/Sao_Paulo')::date
    order by ts desc limit 1
  ) = 'entrada' then 'saida'::tipo_reg_t else 'entrada'::tipo_reg_t end
$$;

-- Ponto normal: NAF (qualquer data), líder (até 7 dias atrás), aluno (só agora, se o setor permitir)
create or replace function bater_ponto(p_aluno uuid, p_tipo tipo_reg_t default null, p_ts timestamptz default null)
returns registros language plpgsql security definer set search_path = public as $$
declare a alunos; s setores; v_origem text; v_ts timestamptz := now(); r registros;
begin
  select * into a from alunos where id = p_aluno and ativo;
  if not found then raise exception 'Aluno não encontrado ou inativo'; end if;
  select * into s from setores where id = a.setor_id;

  if is_naf() then
    v_origem := 'naf'; v_ts := coalesce(p_ts, now());
  elsif lidera_setor(a.setor_id) then
    v_origem := 'lider';
    if p_ts is not null then
      if p_ts < now() - interval '7 days' or p_ts > now() + interval '5 minutes' then
        raise exception 'Lançamentos com mais de 7 dias só podem ser feitos pelo NAF';
      end if;
      v_ts := p_ts;
    end if;
  elsif a.id = meu_aluno_id() then
    if s.modo_ponto <> 'aluno' then raise exception 'Neste setor o ponto é registrado pelo líder'; end if;
    v_origem := 'aluno';           -- aluno nunca escolhe o horário
  else
    raise exception 'Sem permissão';
  end if;

  insert into registros (aluno_id, setor_id, tipo, ts, origem)
  values (a.id, a.setor_id, coalesce(p_tipo, proximo_tipo(a.id, v_ts)), v_ts, v_origem)
  returning * into r;
  return r;
end $$;

-- Turno fixo (ex.: Conservação +4h): lança entrada e saída de uma vez
create or replace function lancar_turno(p_aluno uuid, p_inicio timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare a alunos; s setores; v_origem text;
begin
  select * into a from alunos where id = p_aluno and ativo;
  if not found then raise exception 'Aluno não encontrado ou inativo'; end if;
  select * into s from setores where id = a.setor_id;
  if s.turno_fixo_horas is null then raise exception 'Este setor não usa turno fixo'; end if;

  if is_naf() then v_origem := 'naf';
  elsif lidera_setor(a.setor_id) then
    v_origem := 'lider';
    if p_inicio < now() - interval '7 days' or p_inicio > now() + interval '5 minutes' then
      raise exception 'Lançamentos com mais de 7 dias só podem ser feitos pelo NAF';
    end if;
  else raise exception 'Sem permissão'; end if;

  -- entrada e saída precisam cair no mesmo dia (regra de pareamento)
  if ((p_inicio + make_interval(mins => (s.turno_fixo_horas * 60)::int)) at time zone 'America/Sao_Paulo')::date
     <> (p_inicio at time zone 'America/Sao_Paulo')::date then
    raise exception 'O turno passaria da meia-noite; escolha um horário de início mais cedo';
  end if;

  insert into registros (aluno_id, setor_id, tipo, ts, origem) values
    (a.id, a.setor_id, 'entrada', p_inicio, v_origem),
    (a.id, a.setor_id, 'saida',   p_inicio + make_interval(mins => (s.turno_fixo_horas * 60)::int), v_origem);
end $$;

-- Quiosque: computador logado como líder; aluno digita RA + PIN.
-- Bloqueia o RA por 15 min após 5 PINs errados.
create or replace function bater_ponto_quiosque(p_setor bigint, p_ra text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare a alunos; s setores; v_tipo tipo_reg_t;
begin
  select * into s from setores where id = p_setor and ativo;
  if not found or s.modo_ponto <> 'quiosque' then
    return json_build_object('ok', false, 'erro', 'Setor não está no modo quiosque');
  end if;
  if not (is_naf() or lidera_setor(p_setor)) then
    return json_build_object('ok', false, 'erro', 'Este computador não está logado como líder do setor');
  end if;

  select * into a from alunos where ra = trim(p_ra) and setor_id = p_setor and ativo;
  if not found then return json_build_object('ok', false, 'erro', 'RA ou PIN inválido'); end if;
  if a.pin_bloqueado_ate is not null and a.pin_bloqueado_ate > now() then
    return json_build_object('ok', false, 'erro', 'Muitas tentativas. Tente novamente em alguns minutos.');
  end if;
  if a.pin_hash is null or crypt(p_pin, a.pin_hash) <> a.pin_hash then
    update alunos set pin_falhas = pin_falhas + 1,
      pin_bloqueado_ate = case when pin_falhas + 1 >= 5 then now() + interval '15 minutes' end
    where id = a.id;
    return json_build_object('ok', false, 'erro', 'RA ou PIN inválido');
  end if;

  update alunos set pin_falhas = 0, pin_bloqueado_ate = null where id = a.id;
  v_tipo := proximo_tipo(a.id, now());
  insert into registros (aluno_id, setor_id, tipo, ts, origem)
  values (a.id, p_setor, v_tipo, now(), 'quiosque');
  return json_build_object('ok', true, 'nome', a.nome, 'tipo', v_tipo, 'ts', now());
end $$;

-- PIN do quiosque: definido pelo próprio aluno ou pelo NAF
create or replace function definir_pin(p_aluno uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (is_naf() or p_aluno = meu_aluno_id()) then raise exception 'Sem permissão'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'O PIN deve ter de 4 a 6 números'; end if;
  update alunos set pin_hash = crypt(p_pin, gen_salt('bf')), pin_falhas = 0, pin_bloqueado_ate = null
  where id = p_aluno;
end $$;

-- Cancelar registro (nunca apaga; fica na auditoria)
create or replace function cancelar_registro(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare r registros;
begin
  select * into r from registros where id = p_id;
  if not found then raise exception 'Registro não encontrado'; end if;
  if not (is_naf() or (lidera_setor(r.setor_id) and r.ts > now() - interval '7 days')) then
    raise exception 'Sem permissão';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo'; end if;
  update registros set cancelado = true, motivo_cancelamento = p_motivo where id = p_id;
end $$;

-- Líder (ou NAF) escolhe como o setor bate ponto
create or replace function definir_modo_ponto(p_setor bigint, p_modo modo_ponto_t)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_naf() or lidera_setor(p_setor)) then raise exception 'Sem permissão'; end if;
  update setores set modo_ponto = p_modo where id = p_setor;
end $$;

-- Transferência de setor (só NAF), com histórico
create or replace function transferir_aluno(p_aluno uuid, p_para bigint, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_de bigint;
begin
  if not is_naf() then raise exception 'Só o NAF pode transferir alunos'; end if;
  select setor_id into v_de from alunos where id = p_aluno;
  if not found then raise exception 'Aluno não encontrado'; end if;
  if v_de is not distinct from p_para then return; end if;
  update alunos set setor_id = p_para where id = p_aluno;
  insert into transferencias (aluno_id, de_setor, para_setor, motivo) values (p_aluno, v_de, p_para, p_motivo);
end $$;

grant execute on function meu_papel(), is_naf(), lidera_setor(bigint), meu_aluno_id(),
  bater_ponto(uuid, tipo_reg_t, timestamptz), lancar_turno(uuid, timestamptz),
  bater_ponto_quiosque(bigint, text, text), definir_pin(uuid, text),
  cancelar_registro(bigint, text), definir_modo_ponto(bigint, modo_ponto_t),
  transferir_aluno(uuid, bigint, text)
to authenticated;

-- ---------------------------------------------------------------------
-- Cálculo de horas e saldos (respeitam o RLS de quem consulta)
-- Regra herdada do app atual: entrada/saída casam dentro do mesmo dia;
-- dia com registro sem par conta 0h e aparece como "sem par".
-- ---------------------------------------------------------------------
create or replace view v_horas_dia with (security_invoker = true) as
with r as (
  select aluno_id, tipo, ts,
         (ts at time zone 'America/Sao_Paulo')::date as dia,
         lead(tipo) over w as prox_tipo,
         lead(ts)   over w as prox_ts
  from registros
  where not cancelado
  window w as (partition by aluno_id, (ts at time zone 'America/Sao_Paulo')::date order by ts)
)
select aluno_id, dia,
       count(*) filter (where tipo = 'entrada') <> count(*) filter (where tipo = 'saida') as sem_par,
       case when count(*) filter (where tipo = 'entrada') <> count(*) filter (where tipo = 'saida') then 0
            else round(coalesce(sum(extract(epoch from prox_ts - ts) / 3600)
                   filter (where tipo = 'entrada' and prox_tipo = 'saida'), 0)::numeric, 2)
       end as horas
from r
group by aluno_id, dia;

create or replace view v_saldos with (security_invoker = true) as
with ref as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as ini_mes
), base as (
  select a.id as aluno_id, a.ra, a.nome, a.setor_id, s.nome as setor, a.plano, p.nivel,
         coalesce(p.horas_semana, 0) as horas_semana, a.inicio,
         ref.hoje, ref.ini_mes, (ref.ini_mes - interval '1 month')::date as ini_ant
  from alunos a
  cross join ref
  left join setores s on s.id = a.setor_id
  left join planos  p on p.codigo = a.plano
  where a.ativo
), calc as (
  select b.*,
    -- meta proporcional (horas/semana ÷ 7 × dias corridos), contando a partir do início do aluno
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

revoke all on v_horas_dia, v_saldos from anon, authenticated;
grant select on v_horas_dia, v_saldos to authenticated;

-- Supabase concede acesso a anon por padrão em objetos novos: remover
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
