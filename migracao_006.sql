-- Migração 006 — nomes de setores sempre em MAIÚSCULO
update setores set nome = upper(trim(nome)) where nome <> upper(trim(nome));
create or replace function fn_setor_maiusculo() returns trigger language plpgsql as $$
begin new.nome := upper(trim(new.nome)); return new; end $$;
drop trigger if exists setor_maiusculo on setores;
create trigger setor_maiusculo before insert or update of nome on setores for each row execute function fn_setor_maiusculo();
