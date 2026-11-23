-- RotaPronta — esquema inicial
-- Organizações (restaurantes ou entregadores autônomos), membros e papéis, bases, lotes,
-- imagens privadas, pedidos, rotas, paradas e registros de entrega.
-- Isolamento por RLS: nenhum valor de org_id vindo do cliente é aceito sem conferência.

-- ───────────────────────── tipos ─────────────────────────
create type public.member_role as enum ('owner', 'manager', 'driver');
create type public.org_kind as enum ('restaurant', 'solo');
create type public.batch_status as enum ('draft', 'processing', 'review', 'ready', 'in_progress', 'completed', 'canceled');
create type public.image_status as enum ('uploaded', 'extracting', 'extracted', 'failed');
create type public.order_status as enum ('ready', 'needs_review', 'not_found', 'excluded');
create type public.stop_event_kind as enum ('delivered', 'failed', 'deferred', 'undo');

-- ───────────────────────── tabelas ─────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  kind public.org_kind not null,
  created_by uuid references auth.users (id) on delete set null,
  default_base_id uuid,
  -- preferências operacionais: { "returnToBase": bool, "serviceMinutes": int, "startFrom": "base"|"current" }
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  account_type text check (account_type in ('restaurant', 'driver')),
  active_org_id uuid references public.organizations (id) on delete set null,
  -- { "returnToBase": bool, "serviceMinutes": int, "startFrom": "base"|"current", "mapsTravelMode": "two-wheeler"|"driving" }
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  address_line text not null check (char_length(address_line) between 3 and 300),
  city text not null,
  uf char(2) not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location_provenance text not null check (location_provenance in ('provider', 'candidate_choice', 'manual_pin', 'demo_fixture')),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index bases_org_idx on public.bases (org_id);
alter table public.organizations
  add constraint organizations_default_base_fk foreign key (default_base_id) references public.bases (id) on delete set null;

create table public.invites (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  org_id uuid not null references public.organizations (id) on delete cascade,
  role public.member_role not null default 'driver' check (role in ('driver', 'manager')),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- excluir a conta de quem criou não apaga lotes do restaurante
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  assigned_driver_id uuid references auth.users (id) on delete set null,
  base_id uuid references public.bases (id) on delete set null,
  title text check (char_length(title) <= 80),
  status public.batch_status not null default 'draft',
  processing_step text check (processing_step in ('uploading', 'extracting', 'geocoding', 'planning')),
  last_error text check (char_length(last_error) <= 300),
  start_from text not null default 'base' check (start_from in ('base', 'current')),
  origin_lat double precision,
  origin_lng double precision,
  return_to_base boolean not null default false,
  service_minutes smallint not null default 3 check (service_minutes between 0 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index batches_org_status_idx on public.batches (org_id, status, created_at desc);
create index batches_driver_idx on public.batches (assigned_driver_id, created_at desc);
create index batches_creator_idx on public.batches (created_by, created_at desc);

create table public.batch_images (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null check (bytes > 0 and bytes <= 4194304),
  width integer check (width > 0),
  height integer check (height > 0),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  status public.image_status not null default 'uploaded',
  attempts smallint not null default 0,
  claimed_at timestamptz, -- início da leitura em andamento (permite retomar se travar)
  provider text,
  -- metadados da leitura (qualidade, avisos, contagem). Nunca o texto completo da notinha.
  extraction jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  extracted_at timestamptz,
  unique (batch_id, sha256)
);
create index batch_images_batch_idx on public.batch_images (batch_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_image_id uuid references public.batch_images (id) on delete set null,
  source_index smallint,
  origin text not null check (origin in ('ocr', 'manual', 'demo')),
  client_key text, -- idempotência para inclusões manuais
  order_code text check (char_length(order_code) <= 40),
  recipient_name text check (char_length(recipient_name) <= 120),
  phone text check (phone ~ '^[1-9][0-9]{9,10}$'),
  street text check (char_length(street) <= 200),
  number text check (char_length(number) <= 20),
  neighborhood text check (char_length(neighborhood) <= 200),
  city text check (char_length(city) <= 80),
  uf char(2),
  cep text check (cep ~ '^[0-9]{5}-[0-9]{3}$'),
  complement text check (char_length(complement) <= 160),
  reference text check (char_length(reference) <= 200),
  instructions text check (char_length(instructions) <= 300),
  raw_address_text text check (char_length(raw_address_text) <= 400),
  region jsonb,
  city_inferred boolean not null default false,
  reading_confidence text check (reading_confidence in ('high', 'medium', 'low')),
  review_reasons text[] not null default '{}',
  status public.order_status not null default 'needs_review',
  excluded_reason text check (char_length(excluded_reason) <= 200),
  duplicate_of uuid references public.orders (id) on delete set null,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geocode_precision text,
  location_provenance text check (location_provenance in ('provider', 'candidate_choice', 'manual_pin', 'demo_fixture')),
  geocode_candidates jsonb,
  geocode_query_hash text,
  geocode_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_image_id, source_index),
  unique (batch_id, client_key),
  check (status <> 'ready' or (lat is not null and lng is not null))
);
create index orders_batch_idx on public.orders (batch_id);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  version integer not null,
  status text not null default 'active' check (status in ('active', 'superseded')),
  mode text not null check (mode in ('open', 'closed')),
  travel_mode text not null check (travel_mode in ('TWO_WHEELER', 'DRIVE', 'SIMULATED')),
  provider text not null,
  simulated boolean not null,
  method text not null check (method in ('exact', 'heuristic', 'trivial', 'manual')),
  origin_lat double precision not null,
  origin_lng double precision not null,
  end_lat double precision,
  end_lng double precision,
  distance_m integer not null,
  travel_s integer not null,
  service_s integer not null,
  total_s integer not null,
  original_travel_s integer,
  polylines text[] not null default '{}',
  warnings text[] not null default '{}',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, version)
);
create unique index routes_one_active_idx on public.routes (batch_id) where status = 'active';

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  batch_id uuid not null references public.batches (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  position smallint not null,
  stop_group smallint not null,
  leg_duration_s integer,
  leg_distance_m integer,
  eta_offset_s integer,
  unique (route_id, position),
  unique (route_id, order_id)
);
create index route_stops_route_idx on public.route_stops (route_id);

create table public.stop_events (
  id uuid primary key, -- gerado no aparelho: repetir o envio não duplica
  batch_id uuid not null references public.batches (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  kind public.stop_event_kind not null,
  reason text check (char_length(reason) <= 200),
  undoes_event_id uuid references public.stop_events (id) on delete cascade,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid default auth.uid() references auth.users (id) on delete set null,
  check (kind <> 'undo' or undoes_event_id is not null)
);
create index stop_events_batch_idx on public.stop_events (batch_id, occurred_at);

-- Cache de matrizes de tempo para não repetir chamadas externas (somente servidor).
create table public.matrix_cache (
  batch_id uuid not null references public.batches (id) on delete cascade,
  points_hash text not null,
  travel_mode text not null,
  provider text not null,
  simulated boolean not null,
  cells jsonb not null,
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (batch_id, points_hash)
);

-- Log operacional sem fotos, endereços ou telefones (somente servidor escreve).
create table public.ops_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  actor uuid,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ops_log_org_idx on public.ops_log (org_id, created_at desc);

-- Contadores de uso diário por usuário (limites de OCR/geocodificação/rotas).
create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'America/Sao_Paulo')::date,
  kind text not null,
  count integer not null default 0,
  primary key (user_id, day, kind)
);

-- ───────────────────────── funções auxiliares (RLS) ─────────────────────────
create or replace function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = (select auth.uid()));
$$;

create or replace function public.is_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role in ('owner', 'manager')
  );
$$;

create or replace function public.user_is_member(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_user);
$$;

-- Gestores veem todos os lotes da organização; entregadores só os que criaram ou receberam.
create or replace function public.can_access_batch(p_batch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.batches b
    join public.memberships m on m.org_id = b.org_id and m.user_id = (select auth.uid())
    where b.id = p_batch
      and (m.role in ('owner', 'manager') or b.created_by = (select auth.uid()) or b.assigned_driver_id = (select auth.uid()))
  );
$$;

-- Mesma regra avaliada sobre as colunas da própria linha (necessário em INSERT ... RETURNING).
create or replace function public.can_access_batch_row(p_org uuid, p_created_by uuid, p_driver uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and (m.role in ('owner', 'manager') or p_created_by = (select auth.uid()) or p_driver = (select auth.uid()))
  );
$$;

create or replace function public.shares_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

-- Caminho no storage: {org_id}/{batch_id}/{arquivo}
create or replace function public.can_access_receipt_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
  v_batch uuid;
  v_org uuid;
begin
  if array_length(parts, 1) <> 3 then return false; end if;
  begin
    v_org := parts[1]::uuid;
    v_batch := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (select 1 from public.batches b where b.id = v_batch and b.org_id = v_org)
     and public.can_access_batch(v_batch);
end;
$$;

-- ───────────────────────── gatilhos ─────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger batches_touch before update on public.batches for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

-- org_id dos filhos sempre vem do lote (nunca do cliente)
create or replace function public.inherit_batch_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.batches where id = new.batch_id;
  if v_org is null then raise exception 'lote inexistente' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' and new.batch_id <> old.batch_id then
    raise exception 'não é permitido mover registros entre lotes' using errcode = '42501';
  end if;
  new.org_id := v_org;
  return new;
end;
$$;
create trigger batch_images_org before insert or update on public.batch_images for each row execute function public.inherit_batch_org();
create trigger orders_org before insert or update on public.orders for each row execute function public.inherit_batch_org();
create trigger routes_org before insert or update on public.routes for each row execute function public.inherit_batch_org();
create trigger route_stops_org before insert or update on public.route_stops for each row execute function public.inherit_batch_org();
create trigger stop_events_org before insert on public.stop_events for each row execute function public.inherit_batch_org();

-- Pedido precisa pertencer ao mesmo lote da imagem/rota/evento
create or replace function public.check_order_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'orders' then
    if new.source_image_id is not null and not exists (
      select 1 from public.batch_images i where i.id = new.source_image_id and i.batch_id = new.batch_id) then
      raise exception 'imagem de outro lote' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.orders o where o.id = new.order_id and o.batch_id = new.batch_id) then
      raise exception 'pedido de outro lote' using errcode = '42501';
    end if;
  end if;
  if tg_table_name = 'route_stops' then
    if not exists (select 1 from public.routes r where r.id = new.route_id and r.batch_id = new.batch_id) then
      raise exception 'rota de outro lote' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_links before insert or update on public.orders for each row execute function public.check_order_links();
create trigger route_stops_links before insert or update on public.route_stops for each row execute function public.check_order_links();
create trigger stop_events_links before insert on public.stop_events for each row execute function public.check_order_links();

-- Lote: organização e criador são imutáveis; só gestor atribui a outro entregador
create or replace function public.guard_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- created_by só pode virar nulo (exclusão da conta); nunca ser trocado
    if new.org_id <> old.org_id or (new.created_by is not null and new.created_by is distinct from old.created_by) then
      raise exception 'campos imutáveis' using errcode = '42501';
    end if;
  end if;
  if new.assigned_driver_id is not null
     and (tg_op = 'INSERT' or new.assigned_driver_id is distinct from old.assigned_driver_id) then
    if not public.user_is_member(new.org_id, new.assigned_driver_id) then
      raise exception 'entregador não pertence à organização' using errcode = '42501';
    end if;
    if new.assigned_driver_id <> (select auth.uid()) and not public.is_manager(new.org_id)
       and (select auth.role()) <> 'service_role' then
      raise exception 'apenas gestores atribuem lotes a outros entregadores' using errcode = '42501';
    end if;
  end if;
  if new.base_id is not null and not exists (select 1 from public.bases b where b.id = new.base_id and b.org_id = new.org_id) then
    raise exception 'base de outra organização' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger batches_guard before insert or update on public.batches for each row execute function public.guard_batch();

-- Limites por lote
create or replace function public.enforce_batch_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'batch_images' and (select count(*) from public.batch_images where batch_id = new.batch_id) >= 8 then
    raise exception 'limite de 8 fotos por lote' using errcode = 'P0001', hint = 'batch_image_limit';
  end if;
  if tg_table_name = 'orders' and (select count(*) from public.orders where batch_id = new.batch_id) >= 60 then
    raise exception 'limite de pedidos por lote' using errcode = 'P0001', hint = 'batch_order_limit';
  end if;
  return new;
end;
$$;
create trigger batch_images_limit before insert on public.batch_images for each row execute function public.enforce_batch_limits();
create trigger orders_limit before insert on public.orders for each row execute function public.enforce_batch_limits();

-- Primeiro registro de entrega coloca o lote em andamento
create or replace function public.on_stop_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.batches set status = 'in_progress', started_at = coalesce(started_at, new.occurred_at)
  where id = new.batch_id and status in ('ready', 'review');
  return new;
end;
$$;
create trigger stop_events_progress after insert on public.stop_events for each row execute function public.on_stop_event();

-- Perfil criado junto com o usuário
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────────────────────── RPCs ─────────────────────────
create or replace function public.create_organization(p_name text, p_kind public.org_kind)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'limite de organizações' using errcode = 'P0001';
  end if;
  insert into public.organizations (name, kind, created_by) values (trim(p_name), p_kind, v_uid) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into public.profiles (user_id, account_type, active_org_id)
  values (v_uid, case when p_kind = 'restaurant' then 'restaurant' else 'driver' end, v_org)
  on conflict (user_id) do update set active_org_id = excluded.active_org_id,
    account_type = coalesce(public.profiles.account_type, excluded.account_type);
  return v_org;
end;
$$;

create or replace function public.create_invite(p_org uuid, p_role public.member_role default 'driver')
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not public.is_manager(p_org) then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_role not in ('driver', 'manager') then raise exception 'papel inválido' using errcode = '22023'; end if;
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.invites where code = v_code);
  end loop;
  insert into public.invites (code, org_id, role, created_by) values (v_code, p_org, p_role, auth.uid());
  return v_code;
end;
$$;

create or replace function public.accept_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv public.invites; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_inv from public.invites where code = upper(trim(p_code)) for update;
  if v_inv.code is null or v_inv.used_at is not null or v_inv.expires_at < now() then
    raise exception 'convite inválido ou expirado' using errcode = 'P0001';
  end if;
  insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_uid, v_inv.role)
  on conflict (org_id, user_id) do nothing;
  update public.invites set used_by = v_uid, used_at = now() where code = v_inv.code;
  insert into public.profiles (user_id, account_type, active_org_id) values (v_uid, 'driver', v_inv.org_id)
  on conflict (user_id) do update set active_org_id = excluded.active_org_id;
  return v_inv.org_id;
end;
$$;

-- Lista de membros com nomes (para atribuir lotes)
create or replace function public.org_members(p_org uuid)
returns table (user_id uuid, role public.member_role, display_name text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role, p.display_name
  from public.memberships m left join public.profiles p on p.user_id = m.user_id
  where m.org_id = p_org and public.is_member(p_org)
  order by m.role, p.display_name;
$$;

revoke execute on function public.create_organization(text, public.org_kind) from public, anon;
revoke execute on function public.create_invite(uuid, public.member_role) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
revoke execute on function public.org_members(uuid) from public, anon;
grant execute on function public.create_organization(text, public.org_kind) to authenticated;
grant execute on function public.create_invite(uuid, public.member_role) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.org_members(uuid) to authenticated;

-- ───────────────────────── RLS ─────────────────────────
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.profiles enable row level security;
alter table public.bases enable row level security;
alter table public.invites enable row level security;
alter table public.batches enable row level security;
alter table public.batch_images enable row level security;
alter table public.orders enable row level security;
alter table public.routes enable row level security;
alter table public.route_stops enable row level security;
alter table public.stop_events enable row level security;
alter table public.matrix_cache enable row level security;
alter table public.ops_log enable row level security;
alter table public.usage_counters enable row level security;

create policy org_select on public.organizations for select to authenticated using (public.is_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_manager(id)) with check (public.is_manager(id));

create policy membership_select on public.memberships for select to authenticated using (public.is_member(org_id));
create policy membership_delete on public.memberships for delete to authenticated
  using ((public.is_manager(org_id) and role <> 'owner') or (user_id = (select auth.uid()) and role <> 'owner'));

create policy profile_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.shares_org_with(user_id));
create policy profile_insert on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profile_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (active_org_id is null or public.is_member(active_org_id)));

create policy base_select on public.bases for select to authenticated using (public.is_member(org_id));
create policy base_insert on public.bases for insert to authenticated with check (public.is_manager(org_id));
create policy base_update on public.bases for update to authenticated using (public.is_manager(org_id)) with check (public.is_manager(org_id));
create policy base_delete on public.bases for delete to authenticated using (public.is_manager(org_id));

create policy invite_select on public.invites for select to authenticated using (public.is_manager(org_id));
create policy invite_delete on public.invites for delete to authenticated using (public.is_manager(org_id));

create policy batch_select on public.batches for select to authenticated
  using (public.can_access_batch_row(org_id, created_by, assigned_driver_id));
create policy batch_insert on public.batches for insert to authenticated
  with check (public.is_member(org_id) and created_by = (select auth.uid()));
create policy batch_update on public.batches for update to authenticated
  using (public.can_access_batch_row(org_id, created_by, assigned_driver_id))
  with check (public.can_access_batch_row(org_id, created_by, assigned_driver_id));
create policy batch_delete on public.batches for delete to authenticated
  using (public.is_manager(org_id) or created_by = (select auth.uid()));

create policy image_all on public.batch_images for all to authenticated
  using (public.can_access_batch(batch_id)) with check (public.can_access_batch(batch_id));
create policy order_all on public.orders for all to authenticated
  using (public.can_access_batch(batch_id)) with check (public.can_access_batch(batch_id));
create policy route_all on public.routes for all to authenticated
  using (public.can_access_batch(batch_id)) with check (public.can_access_batch(batch_id));
create policy route_stop_all on public.route_stops for all to authenticated
  using (public.can_access_batch(batch_id)) with check (public.can_access_batch(batch_id));

-- Registros de entrega: somente inclusão (append-only) e leitura
create policy stop_event_select on public.stop_events for select to authenticated using (public.can_access_batch(batch_id));
create policy stop_event_insert on public.stop_events for insert to authenticated
  with check (public.can_access_batch(batch_id) and recorded_by = (select auth.uid()));

create policy ops_log_select on public.ops_log for select to authenticated using (public.is_manager(org_id));
-- matrix_cache e usage_counters: sem políticas = sem acesso para clientes (apenas service_role).

revoke all on public.matrix_cache, public.usage_counters from anon, authenticated;
revoke all on public.ops_log from anon;
revoke insert, update, delete on public.ops_log from authenticated;
revoke update, delete on public.stop_events from authenticated;

-- ───────────────────────── storage privado ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.can_access_receipt_path(name));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.can_access_receipt_path(name));
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.can_access_receipt_path(name));
