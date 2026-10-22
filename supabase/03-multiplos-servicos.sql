-- Migração 03: um pedido pode ter vários serviços (a duração é a soma).
-- Rodar DEPOIS de 02-servicos.sql. Rodar uma única vez.

alter table agendamentos add column servicos text[] not null default '{}';

create unique index if not exists servicos_nome_unico on servicos (negocio_id, nome);

-- O gatilho calcula a duração total e o texto do pedido a partir dos serviços escolhidos
create or replace function agendamento_define_duracao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nomes text[];
  total int;
  qtd int;
begin
  nomes := coalesce(nullif(new.servicos, '{}'::text[]), array[new.servico]);
  nomes := array(select distinct unnest(nomes));

  select coalesce(sum(duracao_min), 0), count(*) into total, qtd from servicos
   where negocio_id = new.negocio_id and nome = any(nomes) and ativo;

  if qtd = 0 or qtd <> cardinality(nomes) then
    raise exception 'serviço inválido';
  end if;

  new.duracao_min := total;
  new.servico := array_to_string(nomes, ' + ');
  return new;
end $$;
