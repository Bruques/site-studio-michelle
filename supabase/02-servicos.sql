-- Migração 02: serviços editáveis, duração por serviço e conflito por intervalo.
-- Rodar DEPOIS de schema.sql (SQL Editor > New query > colar > Run). Rodar uma única vez.

create extension if not exists btree_gist;

-- Serviços (nome, preço e duração editáveis no painel)
create table if not exists servicos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nome text not null,
  descricao text,
  preco numeric(10,2),
  duracao_min int not null check (duracao_min between 5 and 720),
  ordem int not null default 0,
  ativo boolean not null default true
);
alter table servicos enable row level security;
create policy "publico le servicos ativos" on servicos for select using (ativo);
create policy "dono gerencia servicos" on servicos for all
  using (eh_dono(negocio_id)) with check (eh_dono(negocio_id));

-- Horário semanal: agora define só o intervalo entre horários de início (ex.: de 30 em 30 min)
alter table disponibilidade rename column duracao_slot_min to passo_min;
alter table disponibilidade alter column passo_min set default 30;
update disponibilidade set passo_min = 30;

-- Agendamento guarda a duração; um gatilho copia a duração do serviço (o cliente não escolhe)
alter table agendamentos add column duracao_min int not null default 60;

create or replace function agendamento_define_duracao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select duracao_min into new.duracao_min from servicos
   where negocio_id = new.negocio_id and nome = new.servico and ativo;
  if not found then
    raise exception 'serviço inválido';
  end if;
  return new;
end $$;

create trigger agendamento_duracao before insert on agendamentos
  for each row execute function agendamento_define_duracao();

-- Impede qualquer sobreposição de horários (não só o mesmo horário de início)
drop index if exists agendamento_unico;
alter table agendamentos add constraint agendamento_sem_conflito exclude using gist (
  negocio_id with =,
  tsrange((data + hora), (data + hora + duracao_min * interval '1 minute')) with &&
) where (status <> 'cancelado');

-- Folga por horário agora tem início e fim
alter table bloqueios add column hora_fim time;
update bloqueios set hora_fim = hora + interval '1 hour' where hora is not null;

-- Intervalos ocupados do dia, sem expor dados de ninguém
drop function if exists horarios_ocupados(uuid, date);
create function horarios_ocupados(p_negocio uuid, p_data date)
returns table (inicio time, fim time)
language sql stable security definer set search_path = public as $$
  select a.hora, a.hora + (a.duracao_min * interval '1 minute') from agendamentos a
   where a.negocio_id = p_negocio and a.data = p_data and a.status <> 'cancelado'
  union all
  select b.hora, coalesce(b.hora_fim, b.hora + interval '1 hour') from bloqueios b
   where b.negocio_id = p_negocio and b.data = p_data and b.hora is not null;
$$;
grant execute on function horarios_ocupados(uuid, date) to anon, authenticated;

-- Serviços iniciais do piloto (exemplos; ela edita depois no painel)
insert into servicos (negocio_id, nome, descricao, preco, duracao_min, ordem)
select n.id, v.nome, v.descricao, v.preco, v.dur, v.ordem
  from negocios n,
       (values ('Extensão fio a fio', 'Efeito natural e delicado.', 150, 120, 1),
               ('Volume russo', 'Mais densidade e volume.', 190, 150, 2),
               ('Fios tecnológicos', 'Leveza e acabamento sofisticado.', 210, 150, 3),
               ('Manutenção', 'Reposição dos fios em até 20 dias.', 90, 90, 4)) as v(nome, descricao, preco, dur, ordem)
 where n.slug = 'studio-michelle'
   and not exists (select 1 from servicos s where s.negocio_id = n.id);
