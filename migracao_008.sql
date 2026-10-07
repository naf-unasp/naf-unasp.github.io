-- Migração 008: no quiosque, setor com turno fixo lança o turno inteiro (entrada + saída) num só registro
create or replace function bater_ponto_quiosque(p_setor bigint, p_ra text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare a alunos; s setores; v_tipo tipo_reg_t; v_fim timestamptz;
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

  if s.turno_fixo_horas is not null then
    if exists (select 1 from registros where aluno_id = a.id and not cancelado
               and (ts at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date) then
      return json_build_object('ok', false, 'erro', 'A presença de hoje já foi registrada');
    end if;
    v_fim := now() + make_interval(mins => (s.turno_fixo_horas * 60)::int);
    if (v_fim at time zone 'America/Sao_Paulo')::date <> (now() at time zone 'America/Sao_Paulo')::date then
      return json_build_object('ok', false, 'erro', 'O turno passaria da meia-noite; fale com o líder');
    end if;
    insert into registros (aluno_id, setor_id, tipo, ts, origem) values
      (a.id, p_setor, 'entrada', now(), 'quiosque'),
      (a.id, p_setor, 'saida', v_fim, 'quiosque');
    return json_build_object('ok', true, 'nome', a.nome, 'tipo', 'turno', 'horas', s.turno_fixo_horas, 'ts', now());
  end if;

  v_tipo := proximo_tipo(a.id, now());
  insert into registros (aluno_id, setor_id, tipo, ts, origem)
  values (a.id, p_setor, v_tipo, now(), 'quiosque');
  return json_build_object('ok', true, 'nome', a.nome, 'tipo', v_tipo, 'ts', now());
end $$;
select 'migracao 008 ok' as status;
