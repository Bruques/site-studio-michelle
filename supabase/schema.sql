-- Esquema da agenda (multi-cliente). Rodar no Supabase: SQL Editor > New query > colar > Run.

create table if not exists negocios (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nome text not null,
  owner_id uuid references auth.users(id),
  criado_em timestamptz default now()
);

-- Horário de atendimento semanal. dia_semana: 0 = domingo ... 6 = sábado
create table if not exists disponibilidade (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),
  inicio time not null,
  fim time not null,
  duracao_slot_min int not null default 60 check (duracao_slot_min > 0)
);

-- Dias ou horários específicos fechados (folga, férias, compromisso)
create table if not exists bloqueios (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  data date not null,
  hora time, -- nulo = dia inteiro
  motivo text
);

create table if not exists agendamentos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  servico text not null,
  nome_cliente text not null,
  telefone text,
  data date not null,
  hora time not null,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'cancelado')),
  criado_em timestamptz default now()
);

-- Impede dois pedidos ativos no mesmo horário
create unique index if not exists agendamento_unico
  on agendamentos (negocio_id, data, hora)
  where status <> 'cancelado';

alter table negocios enable row level security;
alter table disponibilidade enable row level security;
alter table bloqueios enable row level security;
alter table agendamentos enable row level security;

-- Dono do negócio
create or replace function eh_dono(nid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from negocios where id = nid and owner_id = auth.uid());
$$;

-- Público lê negócios e disponibilidade (necessário para montar a agenda)
create policy "publico le negocios" on negocios for select using (true);
create policy "dono edita negocio" on negocios for update using (owner_id = auth.uid());

create policy "publico le disponibilidade" on disponibilidade for select using (true);
create policy "dono gerencia disponibilidade" on disponibilidade for all
  using (eh_dono(negocio_id)) with check (eh_dono(negocio_id));

create policy "dono gerencia bloqueios" on bloqueios for all
  using (eh_dono(negocio_id)) with check (eh_dono(negocio_id));

-- Agendamentos: público só cria; dono lê e gerencia. Dados pessoais nunca ficam públicos.
create policy "publico cria agendamento" on agendamentos for insert
  with check (status = 'pendente');
create policy "dono gerencia agendamentos" on agendamentos for all
  using (eh_dono(negocio_id)) with check (eh_dono(negocio_id));

-- Horários ocupados, sem expor nome ou telefone de ninguém
create or replace function horarios_ocupados(p_negocio uuid, p_data date)
returns table (hora time)
language sql stable security definer set search_path = public as $$
  select a.hora from agendamentos a
   where a.negocio_id = p_negocio and a.data = p_data and a.status <> 'cancelado'
  union
  select b.hora from bloqueios b
   where b.negocio_id = p_negocio and b.data = p_data and b.hora is not null;
$$;

-- Dia inteiro bloqueado?
create or replace function dia_bloqueado(p_negocio uuid, p_data date)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bloqueios
                  where negocio_id = p_negocio and data = p_data and hora is null);
$$;

grant execute on function horarios_ocupados(uuid, date) to anon, authenticated;
grant execute on function dia_bloqueado(uuid, date) to anon, authenticated;

-- Dados iniciais do piloto (o owner_id é preenchido depois, quando ela criar o login)
insert into negocios (slug, nome) values ('studio-michelle', 'Studio Michelle')
on conflict (slug) do nothing;

insert into disponibilidade (negocio_id, dia_semana, inicio, fim, duracao_slot_min)
select n.id, d, time '09:00', time '18:00', 120
  from negocios n, generate_series(1, 5) d
 where n.slug = 'studio-michelle'
   and not exists (select 1 from disponibilidade x where x.negocio_id = n.id);
