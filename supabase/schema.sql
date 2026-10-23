-- =============================================================================
-- event-checkin :: database schema (Supabase / PostgreSQL 15+)
-- Run this ONCE in the Supabase SQL editor, then run supabase/seed.sql.
--
-- Design notes (details in docs/ARCHITECTURE.md and docs/SECURITY.md):
--   * Every table is locked by RLS / revoked grants. The browser (anon key) can
--     only call the RPC functions listed in the GRANTS section at the bottom.
--   * Admin = PIN (bcrypt hash in private.settings). Team members and observers
--     authenticate with random tokens in their personal links.
--   * "Event day" is computed in the Asia/Kolkata time zone. To use another zone,
--     find-and-replace 'Asia/Kolkata' in this file BEFORE running it.
-- =============================================================================
set check_function_bodies = off;

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_net;   -- used to call the push-notify edge function

-- ---------- tables ----------
create table if not exists private.admin_failures (
  at timestamp with time zone not null default now(),
  ip text
);

create table if not exists private.checkin_attempts (
  ip text not null,
  at timestamp with time zone not null default now()
);

create table if not exists private.observers (
  name text not null,
  token text not null,
  created_at timestamp with time zone not null default now(),
  last_seen timestamp with time zone
);

create table if not exists private.push_subs (
  id bigint generated always as identity,
  rep_key text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamp with time zone not null default now()
);

create table if not exists private.rep_tokens (
  rep_key text not null,
  name text not null,
  token text not null,
  created_at timestamp with time zone not null default now(),
  in_rotation boolean not null default true,
  available boolean not null default true,
  last_seen timestamp with time zone,
  last_assigned_at timestamp with time zone
);

create table if not exists private.rotation_log (
  id bigserial,
  day date not null,
  rep_key text not null,
  at timestamp with time zone not null default now()
);

create table if not exists private.settings (
  key text not null,
  value jsonb not null
);

create table if not exists public.checkin_events (
  id bigserial,
  checkin_id bigint not null,
  kind text not null,
  from_name text,
  to_name text,
  by_who text,
  at timestamp with time zone not null default now()
);

create table if not exists public.checkins (
  id bigint generated always as identity,
  name text not null,
  phone_raw text,
  phone_norm text not null,
  status text not null,
  rsvp_id bigint,
  invited_by text,
  referred_by text,
  prefs jsonb not null default '{}'::jsonb,
  consent boolean not null default false,
  created_at timestamp with time zone not null default now(),
  day date not null default ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date,
  assigned_to text,
  ack_by text,
  ack_at timestamp with time zone,
  linked_at timestamp with time zone,
  passed_from text,
  passed_at timestamp with time zone,
  passed_by text,
  dup_rsvp_id bigint,
  dup_checkin_id bigint,
  additional integer not null default 0,
  builder text,
  done_at timestamp with time zone,
  done_by text
);

create table if not exists public.leads (
  phone_norm text not null,
  stage text not null default 'New'::text,
  note text,
  updated_by text,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.phone_aliases (
  phone_norm text not null,
  rsvp_id bigint not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.rsvp (
  id bigint generated always as identity,
  name text not null,
  phone_raw text,
  phone_norm text not null,
  invited_by text,
  created_at timestamp with time zone not null default now(),
  invite_day date
);

-- ---------- constraints ----------
alter table private.observers add constraint observers_token_key UNIQUE (token);
alter table private.observers add constraint observers_pkey PRIMARY KEY (name);
alter table private.push_subs add constraint push_subs_endpoint_key UNIQUE (endpoint);
alter table private.push_subs add constraint push_subs_pkey PRIMARY KEY (id);
alter table private.rep_tokens add constraint rep_tokens_token_key UNIQUE (token);
alter table private.rep_tokens add constraint rep_tokens_pkey PRIMARY KEY (rep_key);
alter table private.rotation_log add constraint rotation_log_pkey PRIMARY KEY (id);
alter table private.settings add constraint settings_pkey PRIMARY KEY (key);
alter table public.checkin_events add constraint checkin_events_pkey PRIMARY KEY (id);
alter table public.checkins add constraint checkins_pkey PRIMARY KEY (id);
alter table public.leads add constraint leads_pkey PRIMARY KEY (phone_norm);
alter table public.phone_aliases add constraint phone_aliases_pkey PRIMARY KEY (phone_norm);
alter table public.rsvp add constraint rsvp_phone_norm_key UNIQUE (phone_norm);
alter table public.rsvp add constraint rsvp_pkey PRIMARY KEY (id);
alter table private.observers add constraint observers_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)));
alter table public.checkins add constraint checkins_additional_range CHECK (((additional >= 0) AND (additional <= 20)));
alter table public.checkins add constraint checkins_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'walkin'::text])));
alter table public.leads add constraint leads_stage_check CHECK ((stage = ANY (ARRAY['New'::text, 'Yet To Talk'::text, 'Followup'::text, 'Hot'::text, 'Cold'::text, 'Converted'::text, 'Lost'::text, 'Warm'::text])));
alter table public.checkin_events add constraint checkin_events_checkin_id_fkey FOREIGN KEY (checkin_id) REFERENCES checkins(id) ON DELETE CASCADE;
alter table public.checkins add constraint checkins_rsvp_id_fkey FOREIGN KEY (rsvp_id) REFERENCES rsvp(id) ON DELETE SET NULL;
alter table public.phone_aliases add constraint phone_aliases_rsvp_id_fkey FOREIGN KEY (rsvp_id) REFERENCES rsvp(id) ON DELETE CASCADE;

-- ---------- indexes ----------
CREATE INDEX admin_failures_ip_at ON private.admin_failures USING btree (ip, at);
CREATE INDEX checkin_attempts_ip_at ON private.checkin_attempts USING btree (ip, at);
CREATE UNIQUE INDEX observers_name_ci ON private.observers USING btree (lower(name));
CREATE INDEX push_subs_rep ON private.push_subs USING btree (rep_key);
CREATE INDEX rotation_log_day_rep ON private.rotation_log USING btree (day, rep_key);
CREATE INDEX checkins_created_at_idx ON public.checkins USING btree (created_at);
CREATE INDEX checkins_day ON public.checkins USING btree (day);
CREATE UNIQUE INDEX checkins_phone_day ON public.checkins USING btree (phone_norm, day);
CREATE UNIQUE INDEX checkins_rsvp_day ON public.checkins USING btree (rsvp_id, day) WHERE (rsvp_id IS NOT NULL);
CREATE INDEX checkins_rsvp_id_idx ON public.checkins USING btree (rsvp_id);

-- ---------- row level security ----------
alter table public.checkin_events enable row level security;
alter table public.checkins enable row level security;
alter table public.leads enable row level security;
alter table public.phone_aliases enable row level security;
alter table public.rsvp enable row level security;

-- ---------- functions ----------
CREATE OR REPLACE FUNCTION private.push_url()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select value #>> '{}' from private.settings where key = 'push_functions_url'
$function$
;

CREATE OR REPLACE FUNCTION private.canon_builder(t text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with parts as (
    select distinct on (lower(btrim(p))) lower(btrim(p)) lp, ord
    from regexp_split_to_table(coalesce(t, ''), ',') with ordinality as s(p, ord)
    where btrim(p) <> '' order by lower(btrim(p)), ord),
  cfg as (
    select b, o from jsonb_array_elements_text(coalesce((select value->'builders' from private.settings where key = 'config'), '[]'::jsonb)) with ordinality as c(b, o)),
  j as (select p.lp, c.b, c.o from parts p left join cfg c on lower(btrim(c.b)) = p.lp)
  select case when count(*) = 0 or count(*) <> count(b) then null else string_agg(b, ', ' order by o) end from j
$function$
;

CREATE OR REPLACE FUNCTION private.client_ip()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    current_setting('request.headers', true)::json->>'cf-connecting-ip',
    split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1),
    'unknown')
$function$
;

CREATE OR REPLACE FUNCTION private.current_reps()
 RETURNS TABLE(rep_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lower(trim(n)) from (
    select invited_by n from public.rsvp
    union all
    select jsonb_array_elements_text(s.value->'team') from private.settings s where s.key = 'config'
  ) a where coalesce(trim(n),'') <> '' group by lower(trim(n))
$function$
;

CREATE OR REPLACE FUNCTION private.do_check_in(p_name text, p_phone text, p_prefs jsonb, p_referred_by text, p_consent boolean, p_additional integer DEFAULT 0, p_builder text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_phone text := private.norm_phone(p_phone);
        v_name text := left(trim(coalesce(p_name,'')), 100);
        v_day date := (now() at time zone 'Asia/Kolkata')::date;
        v_ref text := nullif(left(trim(coalesce(p_referred_by,'')), 100), '');
        v_bld text := private.canon_builder(p_builder); v_add int := greatest(0, least(coalesce(p_additional,0), 20)); r public.rsvp%rowtype; v_assigned text; v_id bigint; v_status text;
begin
  if length(v_name) < 2 then return jsonb_build_object('ok',false,'error','Please enter your name.'); end if;
  if length(v_phone) <> 10 then return jsonb_build_object('ok',false,'error','Please enter a valid 10-digit mobile number.'); end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' or length(p_prefs::text) > 4000 then p_prefs := '{}'::jsonb; end if;

  if exists (select 1 from public.checkins where phone_norm = v_phone and day = v_day) then
    update public.checkins set additional = greatest(additional, v_add), builder = coalesce(builder, v_bld), done_at = null, done_by = null where phone_norm = v_phone and day = v_day;
    return jsonb_build_object('ok',true,'status','duplicate','name',v_name);
  end if;

  select * into r from public.rsvp where phone_norm = v_phone;
  if not found then
    select x.* into r from public.phone_aliases a join public.rsvp x on x.id = a.rsvp_id where a.phone_norm = v_phone;
  end if;
  if r.id is not null and exists (select 1 from public.checkins where rsvp_id = r.id and day = v_day) then
    update public.checkins set additional = greatest(additional, v_add), builder = coalesce(builder, v_bld), done_at = null, done_by = null where rsvp_id = r.id and day = v_day;
    return jsonb_build_object('ok',true,'status','duplicate','name',v_name);   -- same invited guest, different number
  end if;
  v_status := case when r.id is null then 'walkin' else 'invited' end;
  if v_status = 'walkin' and v_ref is null then v_assigned := private.pick_random_walkin_owner(); end if;

  insert into public.checkins(name, phone_raw, phone_norm, status, rsvp_id, invited_by, referred_by, prefs, consent, day, assigned_to, additional, builder)
  values (v_name, left(p_phone, 30), v_phone, v_status, r.id, r.invited_by, v_ref, p_prefs, coalesce(p_consent,false), v_day, v_assigned, v_add, v_bld)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then update public.checkins set additional = greatest(additional, v_add), builder = coalesce(builder, v_bld), done_at = null, done_by = null where phone_norm = v_phone and day = v_day; return jsonb_build_object('ok',true,'status','duplicate','name',v_name); end if;
  return jsonb_build_object('ok',true,'status',v_status,'name',v_name,
    'owner', coalesce(r.invited_by, v_ref, (select t.name from private.rep_tokens t where t.rep_key = v_assigned)));
end $function$
;

CREATE OR REPLACE FUNCTION private.ensure_reps()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into private.rep_tokens(rep_key, name, token)
  select r.rep_key, r.name, encode(extensions.gen_random_bytes(18), 'hex') from (
    select lower(trim(n)) rep_key, min(trim(n)) name from (
      select invited_by n from public.rsvp
      union all
      select jsonb_array_elements_text(s.value->'team') from private.settings s where s.key = 'config'
    ) a where coalesce(trim(n),'') <> '' group by lower(trim(n))
  ) r
  on conflict (rep_key) do nothing
$function$
;

CREATE OR REPLACE FUNCTION private.flag_similar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'walkin' then
    select x.id into new.dup_rsvp_id from public.rsvp x
     where private.names_alike(new.name, x.name)
       and not exists (select 1 from public.checkins c2 where c2.rsvp_id = x.id and c2.day = new.day)
     order by extensions.similarity(private.name_key(new.name), private.name_key(x.name)) desc limit 1;
  end if;
  select c2.id into new.dup_checkin_id from public.checkins c2
   where c2.day = new.day and c2.phone_norm <> new.phone_norm and private.names_alike(new.name, c2.name)
   order by c2.created_at limit 1;
  return new;
exception when others then
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.is_admin(p_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_hash text; v_ip text := private.client_ip();
begin
  if (select count(*) from private.admin_failures where ip = v_ip and at > now() - interval '15 minutes') >= 20
     or (select count(*) from private.admin_failures where at > now() - interval '15 minutes') >= 300 then
    return false;
  end if;
  select value #>> '{}' into v_hash from private.settings where key = 'admin_pin_hash';
  if v_hash is not null and extensions.crypt(coalesce(p_pin, ''), v_hash) = v_hash then
    return true;
  end if;
  insert into private.admin_failures(ip) values (v_ip);
  delete from private.admin_failures where at < now() - interval '1 day';
  return false;
end $function$
;

CREATE OR REPLACE FUNCTION private.is_viewer(p_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if left(coalesce(p_pin, ''), 4) = 'obs_' then
    return exists (select 1 from private.observers where token = p_pin);
  end if;
  return private.is_admin(p_pin);
end $function$
;

CREATE OR REPLACE FUNCTION private.name_key(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(t,'')), '[^a-z ]', ' ', 'g'), '\s+', ' ', 'g'))
$function$
;

CREATE OR REPLACE FUNCTION private.names_alike(a text, b text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare ka text := private.name_key(a); kb text := private.name_key(b); ta text[]; tb text[];
begin
  if length(ka) < 4 or length(kb) < 4 then return false; end if;
  if ka = kb then return true; end if;
  if extensions.similarity(ka, kb) >= 0.5 then return true; end if;
  ta := string_to_array(ka, ' '); tb := string_to_array(kb, ' ');
  if array_length(ta,1) >= 2 and array_length(tb,1) >= 2 and (ta <@ tb or tb <@ ta) then return true; end if;
  return false;
end $function$
;

CREATE OR REPLACE FUNCTION private.norm_phone(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 10)
$function$
;

CREATE OR REPLACE FUNCTION private.notify_checkin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_secret text; v_url text;
begin
  select value #>> '{}' into v_secret from private.settings where key = 'push_secret';
  select value #>> '{}' into v_url from private.settings where key = 'push_functions_url';
  if v_secret is not null and v_url is not null and exists (
       select 1 from private.push_subs s
       where s.rep_key in (lower(trim(coalesce(new.invited_by,''))), lower(trim(coalesce(new.referred_by,''))), coalesce(new.assigned_to,''))) then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_secret),
      body := jsonb_build_object('kind','checkin','id', new.id), timeout_milliseconds := 8000);
  end if;
  return new;
exception when others then
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.pick_random_walkin_owner()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text; v_day date := (now() at time zone 'Asia/Kolkata')::date; v_w jsonb;
begin
  perform private.ensure_reps();
  select value into v_w from private.settings where key = 'walkin_weights';
  if v_w is null or jsonb_typeof(v_w) <> 'object' then return private.pick_walkin_owner(); end if;
  perform pg_advisory_xact_lock(777001);   -- one pick at a time, so shares stay exact under load
  select t.rep_key into v
  from private.rep_tokens t
  cross join lateral (select coalesce((v_w ->> t.rep_key)::numeric, 0) w) x
  where x.w > 0 and t.in_rotation and t.available
    and t.rep_key in (select rep_key from private.current_reps())
  order by (select count(*) from private.rotation_log l where l.day = v_day and l.rep_key = t.rep_key)::numeric / x.w,
           x.w desc, t.rep_key
  limit 1;
  if v is null then return private.pick_walkin_owner(); end if;   -- everyone listed is away: fall back to whoever is free
  insert into private.rotation_log(day, rep_key) values (v_day, v);
  update private.rep_tokens set last_assigned_at = now() where rep_key = v;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION private.pick_walkin_owner()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform private.ensure_reps();
  select t.rep_key into v from private.rep_tokens t
   where t.in_rotation and t.available and t.rep_key in (select rep_key from private.current_reps())
     and not exists (select 1 from public.checkins c where c.assigned_to = t.rep_key and c.ack_at is null and c.day = v_today)
     and not exists (select 1 from public.checkins c where c.ack_by = t.name and c.ack_at > now() - interval '20 minutes')
   order by coalesce(t.last_assigned_at, 'epoch'::timestamptz), t.rep_key
   limit 1 for update of t;
  if v is null then   -- everyone is busy: still hand it to whoever has waited longest
    select t.rep_key into v from private.rep_tokens t
     where t.in_rotation and t.available and t.rep_key in (select rep_key from private.current_reps())
     order by coalesce(t.last_assigned_at, 'epoch'::timestamptz), t.rep_key
     limit 1 for update of t;
  end if;
  if v is not null then update private.rep_tokens set last_assigned_at = now() where rep_key = v; end if;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION private.rep_from_token(p_token text)
 RETURNS private.rep_tokens
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens%rowtype;
begin
  select * into t from private.rep_tokens where token = coalesce(p_token, '');
  if not found then return null; end if;
  return t;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_dashboard(p_pin text, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  perform private.ensure_reps();
  select jsonb_build_object(
    'generated_at', now(), 'today', v_today, 'day', p_day,
    'days', coalesce((select jsonb_agg(d order by d) from (select day d from public.checkins union select invite_day from public.rsvp where invite_day is not null) x), '[]'::jsonb),
    'invited', (select count(*) from public.rsvp r where (p_day is null or r.invite_day is null or r.invite_day = p_day or not exists (select 1 from public.rsvp z where z.invite_day = p_day) or exists (select 1 from public.checkins cz where cz.rsvp_id = r.id and cz.day = p_day))),
    'arrived_invited', (select count(distinct c.rsvp_id) from public.checkins c where c.status = 'invited' and c.rsvp_id is not null and (p_day is null or c.day = p_day)),
    'walkins', (select count(distinct c.phone_norm) from public.checkins c where c.status = 'walkin' and (p_day is null or c.day = p_day)),
    'waiting', (select count(*) from public.checkins c where c.ack_at is null and c.day = v_today), 'by_builder', (select coalesce(jsonb_object_agg(b, n), '{}'::jsonb) from (select btrim(x.bn) b, count(*) n from public.checkins c, unnest(string_to_array(c.builder, ',')) as x(bn) where c.builder is not null and (p_day is null or c.day = p_day) group by 1) bb),  'additional', (select coalesce(sum(m),0)::int from (select max(c.additional) m from public.checkins c where (p_day is null or c.day = p_day) group by coalesce(c.rsvp_id::text, c.phone_norm)) x), 'headcount', (select count(distinct coalesce(c.rsvp_id::text, c.phone_norm)) from public.checkins c where (p_day is null or c.day = p_day)) + (select coalesce(sum(m),0)::int from (select max(c.additional) m from public.checkins c where (p_day is null or c.day = p_day) group by coalesce(c.rsvp_id::text, c.phone_norm)) y), 
    'by_team', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'invited', invited, 'arrived', arrived, 'walkins', walkins, 'additional', additional) order by arrived desc, walkins desc, invited desc)
      from (
        select max(n) name,
               count(distinct k) filter (where kind = 'inv') invited,
               count(distinct k) filter (where kind = 'arr') arrived,
               count(distinct k) filter (where kind = 'wk') walkins,
               coalesce(sum(amt) filter (where kind in ('arr','wk')), 0)::int additional
        from (
          select max(n) n, kind, k, max(amt) amt from (
            select coalesce(nullif(trim(r.invited_by),''),'Unassigned') n, 'inv' kind, r.id::text k, 0 amt from public.rsvp r where (p_day is null or r.invite_day is null or r.invite_day = p_day or not exists (select 1 from public.rsvp z where z.invite_day = p_day) or exists (select 1 from public.checkins cz where cz.rsvp_id = r.id and cz.day = p_day))
            union all
            select coalesce(nullif(trim(r.invited_by),''),'Unassigned'), 'arr', r.id::text,
                   coalesce((select max(c.additional) from public.checkins c where c.rsvp_id = r.id and (p_day is null or c.day = p_day)), 0)
              from public.rsvp r
              where exists (select 1 from public.checkins c where c.rsvp_id = r.id and (p_day is null or c.day = p_day))
            union all
            select coalesce((select t.name from private.rep_tokens t where t.rep_key = c.assigned_to and c.passed_at is not null), nullif(trim(c.referred_by),''), (select t.name from private.rep_tokens t where t.rep_key = c.assigned_to)), 'wk', c.phone_norm, c.additional
              from public.checkins c
              where c.status = 'walkin' and (p_day is null or c.day = p_day)
                and coalesce(nullif(trim(c.referred_by),''), c.assigned_to) is not null
          ) u0 group by lower(n), kind, k
        ) u group by lower(n)
      ) t), '[]'::jsonb),
    'prefs', coalesce((
      select jsonb_object_agg(k, items) from (
        select k, jsonb_agg(jsonb_build_object('label', val, 'count', cnt) order by cnt desc) items from (
          select e.k, z.val, count(*)::int cnt
          from public.checkins c
          cross join lateral jsonb_each(c.prefs) e(k, v)
          cross join lateral jsonb_array_elements_text(case when jsonb_typeof(e.v) = 'array' then e.v else jsonb_build_array(e.v) end) z(val)
          where coalesce(z.val,'') <> '' and (p_day is null or c.day = p_day)
          group by e.k, z.val
        ) p group by k
      ) q), '{}'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('t', b, 'invited', i, 'walkin', w) order by b) from (
        select date_bin('15 minutes', created_at, timestamptz '2000-01-01') b,
               count(*) filter (where status = 'invited')::int i, count(*) filter (where status = 'walkin')::int w
        from public.checkins where (p_day is null or day = p_day) group by 1
      ) tl), '[]'::jsonb),
    'stages', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*)::int n from public.leads group by stage) s), '{}'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone_raw, 'status', c.status,
             'invited_by', c.invited_by, 'referred_by', c.referred_by,
             'assigned_to', (select t.name from private.rep_tokens t where t.rep_key = c.assigned_to),
             'ack_by', c.ack_by, 'ack_at', c.ack_at, 'day', c.day, 'prefs', c.prefs, 'consent', c.consent, 'at', c.created_at,
             'stage', coalesce(l.stage, 'New'), 'note', l.note, 'linked', c.linked_at is not null, 'passed_from', c.passed_from, 'passed_at', c.passed_at, 'passed_by', c.passed_by, 'additional', c.additional, 'builder', c.builder, 'done_at', c.done_at, 'done_by', c.done_by, 'invite_day', (select z.invite_day from public.rsvp z where z.id = c.rsvp_id), 'dup_rsvp', (select jsonb_build_object('id', x.id, 'name', x.name, 'phone', x.phone_raw, 'invited_by', x.invited_by) from public.rsvp x where x.id = c.dup_rsvp_id and c.status = 'walkin' and not exists (select 1 from public.checkins c3 where c3.rsvp_id = x.id and c3.day = c.day)), 'dup_checkin', (select jsonb_build_object('id', z.id, 'name', z.name, 'phone', z.phone_raw, 'status', z.status) from public.checkins z where z.id = c.dup_checkin_id))
             order by c.created_at desc)
      from public.checkins c
      left join public.leads l on l.phone_norm = coalesce((select x.phone_norm from public.rsvp x where x.id = c.rsvp_id), c.phone_norm)
      where (p_day is null or c.day = p_day)), '[]'::jsonb),
    'not_arrived', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'phone', r.phone_raw, 'invited_by', r.invited_by, 'invite_day', r.invite_day,
             'stage', coalesce(l.stage, 'New'), 'note', l.note,
             'visited', (select coalesce(jsonb_agg(distinct c2.day), '[]'::jsonb) from public.checkins c2 where c2.rsvp_id = r.id))
             order by r.invited_by, r.name)
      from public.rsvp r left join public.leads l on l.phone_norm = r.phone_norm
      where (p_day is null or r.invite_day is null or r.invite_day = p_day or not exists (select 1 from public.rsvp z where z.invite_day = p_day) or exists (select 1 from public.checkins cz where cz.rsvp_id = r.id and cz.day = p_day)) and not exists (select 1 from public.checkins c where c.rsvp_id = r.id and (p_day is null or c.day = p_day))), '[]'::jsonb),
    'reps', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'in_rotation', t.in_rotation, 'available', t.available,
             'devices', (select count(*) from private.push_subs s where s.rep_key = t.rep_key),
             'last_seen', t.last_seen,
             'open_walkins', (select count(*) from public.checkins c where c.assigned_to = t.rep_key and c.ack_at is null and c.day = v_today),
             'last_ack_at', (select max(c.ack_at) from public.checkins c where c.ack_by = t.name))
             order by lower(t.name))
      from private.rep_tokens t where t.rep_key in (select rep_key from private.current_reps())), '[]'::jsonb)
  ) into v;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_checkin(p_pin text, p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  delete from public.checkins where id = p_id;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_import_rsvp(p_pin text, p_rows jsonb, p_replace boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_in int; v_total int; v_bad int; v_dupes int;
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  if jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('error','invalid rows'); end if;
  if p_replace then
    update public.checkins set rsvp_id = null where rsvp_id is not null;
    delete from public.rsvp where true;
  end if;
  with src as (
    select t.ord, trim(t.x->>'name') name, t.x->>'phone' phone_raw, private.norm_phone(t.x->>'phone') phone_norm,
           nullif(trim(t.x->>'invited_by'),'') invited_by
    from jsonb_array_elements(p_rows) with ordinality as t(x, ord)
  ), valid as (
    select * from src where length(phone_norm) = 10 and coalesce(name,'') <> ''
  ), good as (
    select distinct on (phone_norm) * from valid order by phone_norm, ord
  ), ins as (
    insert into public.rsvp(name, phone_raw, phone_norm, invited_by)
    select name, phone_raw, phone_norm, invited_by from good
    on conflict (phone_norm) do update set name = excluded.name, phone_raw = excluded.phone_raw, invited_by = excluded.invited_by
    returning 1
  )
  select (select count(*) from ins), (select count(*) from src),
         (select count(*) from src) - (select count(*) from valid),
         (select count(*) from valid) - (select count(*) from good)
  into v_in, v_total, v_bad, v_dupes;

  update public.checkins c set status = 'invited', rsvp_id = r.id, invited_by = r.invited_by
  from public.rsvp r where r.phone_norm = c.phone_norm and (c.rsvp_id is distinct from r.id or c.invited_by is distinct from r.invited_by);
  update public.checkins c set status = 'walkin', invited_by = null where c.rsvp_id is null and c.status = 'invited';

  return jsonb_build_object('imported', v_in, 'rows', v_total, 'skipped_invalid', v_bad,
                            'duplicates_in_file', v_dupes, 'total_rsvp', (select count(*) from public.rsvp));
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_link_checkin(p_pin text, p_checkin_id bigint, p_rsvp_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.checkins%rowtype; r public.rsvp%rowtype; v_secret text;
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  select * into c from public.checkins where id = p_checkin_id;
  if not found then return jsonb_build_object('error','Check-in not found'); end if;
  select * into r from public.rsvp where id = p_rsvp_id;
  if not found then return jsonb_build_object('error','Guest not found'); end if;
  if exists (select 1 from public.checkins x where x.rsvp_id = r.id and x.day = c.day and x.id <> c.id) then
    return jsonb_build_object('error', r.name || ' has already checked in that day.');
  end if;
  update public.checkins set rsvp_id = r.id, status = 'invited', invited_by = r.invited_by, assigned_to = null, linked_at = now() where id = c.id;
  if c.phone_norm <> r.phone_norm then
    insert into public.phone_aliases(phone_norm, rsvp_id) values (c.phone_norm, r.id)
    on conflict (phone_norm) do update set rsvp_id = excluded.rsvp_id;
    -- carry lead stage/notes over; if both already have notes keep both and the more recent stage
    insert into public.leads(phone_norm, stage, note, updated_by, updated_at)
      select r.phone_norm, l.stage, l.note, l.updated_by, l.updated_at from public.leads l where l.phone_norm = c.phone_norm
    on conflict (phone_norm) do update set
      stage = case when excluded.updated_at > public.leads.updated_at then excluded.stage else public.leads.stage end,
      note = nullif(concat_ws(' | ', public.leads.note, excluded.note), ''),
      updated_at = greatest(excluded.updated_at, public.leads.updated_at);
    delete from public.leads where phone_norm = c.phone_norm;
  end if;
  select value #>> '{}' into v_secret from private.settings where key = 'push_secret';
  if v_secret is not null and exists (select 1 from private.push_subs s where s.rep_key = lower(trim(coalesce(r.invited_by,'')))) then
    perform net.http_post(
      url := private.push_url(),
      headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_secret),
      body := jsonb_build_object('kind','checkin','id', c.id), timeout_milliseconds := 8000);
  end if;
  return jsonb_build_object('ok', true, 'guest', r.name, 'invited_by', r.invited_by);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_login(p_pin text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.is_admin(p_pin) $function$
;

CREATE OR REPLACE FUNCTION public.admin_manual_checkin(p_pin text, p_rsvp_id bigint, p_additional integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.rsvp%rowtype;
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  select * into r from public.rsvp where id = p_rsvp_id;
  if not found then return jsonb_build_object('error','Guest not found'); end if;
  return private.do_check_in(r.name, r.phone_raw, '{}'::jsonb, null, false, p_additional);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_manual_walkin(p_pin text, p_name text, p_phone text, p_referred_by text DEFAULT NULL::text, p_additional integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  return private.do_check_in(p_name, p_phone, '{}'::jsonb, p_referred_by, false, p_additional);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_merge_checkin(p_pin text, p_keep_id bigint, p_drop_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k public.checkins%rowtype; d public.checkins%rowtype; t public.checkins%rowtype; v_key text;
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','Only the admin PIN can merge entries.'); end if;
  select * into k from public.checkins where id = p_keep_id for update;
  if not found then return jsonb_build_object('error','Entry not found'); end if;
  select * into d from public.checkins where id = p_drop_id for update;
  if not found then return jsonb_build_object('error','Entry not found'); end if;
  if k.id = d.id or k.day <> d.day then return jsonb_build_object('error','These two entries cannot be merged.'); end if;
  if d.rsvp_id is not null and k.rsvp_id is null then t := k; k := d; d := t; end if;   -- always keep the invited-guest entry
  if d.rsvp_id is not null then return jsonb_build_object('error','Both entries are invited guests, so they are different people.'); end if;
  if k.rsvp_id is not null then
    v_key := (select phone_norm from public.rsvp where id = k.rsvp_id);
    if d.phone_norm <> v_key then
      insert into public.phone_aliases(phone_norm, rsvp_id) values (d.phone_norm, k.rsvp_id) on conflict (phone_norm) do nothing;
    end if;
  else v_key := k.phone_norm; end if;
  update public.checkins set
      prefs = case when prefs is null or prefs = '{}'::jsonb then d.prefs else prefs end,
      referred_by = coalesce(referred_by, d.referred_by),
      ack_by = coalesce(ack_by, d.ack_by), ack_at = coalesce(ack_at, d.ack_at)
    where id = k.id;
  if d.phone_norm <> v_key then
    insert into public.leads(phone_norm, stage, note, updated_by, updated_at)
      select v_key, l.stage, l.note, l.updated_by, l.updated_at from public.leads l where l.phone_norm = d.phone_norm
    on conflict (phone_norm) do nothing;
    delete from public.leads where phone_norm = d.phone_norm;
  end if;
  delete from public.checkins where id = d.id;
  insert into public.checkin_events(checkin_id, kind, from_name, to_name, by_who)
    values (k.id, 'merge', d.name || ' (' || d.phone_raw || ')', k.name, 'Admin');
  return jsonb_build_object('ok', true, 'kept', k.name, 'removed', d.name);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_observer_add(p_pin text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error', 'Not authorised'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then return jsonb_build_object('error', 'Enter a name (up to 60 characters).'); end if;
  if (select count(*) from private.observers) >= 50 then return jsonb_build_object('error', 'Observer limit (50) reached.'); end if;
  if exists (select 1 from private.observers where lower(name) = lower(v_name)) then return jsonb_build_object('error', 'That name already has a link.'); end if;
  insert into private.observers(name, token) values (v_name, 'obs_' || encode(extensions.gen_random_bytes(18), 'hex'));
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_observer_remove(p_pin text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error', 'Not authorised'); end if;
  delete from private.observers where name = p_name;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_observer_rotate(p_pin text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error', 'Not authorised'); end if;
  update private.observers set token = 'obs_' || encode(extensions.gen_random_bytes(18), 'hex'), last_seen = null where name = p_name;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_observers(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error', 'Not authorised'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', name, 'token', token, 'created_at', created_at, 'last_seen', last_seen) order by created_at) from private.observers), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_reassign(p_pin text, p_checkin_id bigint, p_to text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.checkins%rowtype; t private.rep_tokens%rowtype;
  v_from text; v_by text; v_secret text; v_to_key text; v_cur_key text; v_try int := 0;
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  select * into c from public.checkins where id = p_checkin_id for update;
  if not found then return jsonb_build_object('error','Check-in not found'); end if;
  perform private.ensure_reps();
  v_cur_key := coalesce(c.assigned_to, nullif(lower(trim(coalesce(c.referred_by,''))),''), nullif(lower(trim(coalesce(c.invited_by,''))),''));
  if nullif(btrim(coalesce(p_to,'')),'') is null then
    -- next free person, but never the person who currently has the guest
    while v_try < 3 loop
      v_to_key := private.pick_walkin_owner();
      exit when v_to_key is null or v_to_key is distinct from v_cur_key;
      v_to_key := null; v_try := v_try + 1;
    end loop;
    if v_to_key is null then return jsonb_build_object('error','Nobody else is available right now. Pick a team member by name.'); end if;
  else
    select rep_key into v_to_key from private.rep_tokens
     where rep_key in (select rep_key from private.current_reps()) and lower(name) = lower(btrim(p_to));
    if v_to_key is null then return jsonb_build_object('error','Unknown team member'); end if;
  end if;
  select * into t from private.rep_tokens where rep_key = v_to_key;
  if v_to_key is not distinct from v_cur_key then
    return jsonb_build_object('error', t.name || ' already has this guest');
  end if;
  v_from := coalesce((select name from private.rep_tokens where rep_key = c.assigned_to), nullif(btrim(c.referred_by),''), nullif(btrim(c.invited_by),''));
  v_by := case when left(coalesce(p_pin,''),4) = 'obs_' then coalesce((select name from private.observers where token = p_pin),'Observer') else 'Admin' end;
  update public.checkins set assigned_to = t.rep_key, ack_by = null, ack_at = null, done_at = null, done_by = null,
         passed_from = v_from, passed_at = now(), passed_by = v_by where id = c.id;
  update private.rep_tokens set last_assigned_at = now() where rep_key = t.rep_key;
  insert into public.checkin_events(checkin_id, kind, from_name, to_name, by_who) values (c.id, 'reassign', v_from, t.name, v_by);
  begin
    select value #>> '{}' into v_secret from private.settings where key = 'push_secret';
    if v_secret is not null then
      perform net.http_post(url := private.push_url(),
        headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_secret),
        body := jsonb_build_object('kind','pass','id', c.id), timeout_milliseconds := 8000);
    end if;
  exception when others then null;
  end;
  return jsonb_build_object('ok', true, 'to', t.name, 'from', v_from, 'name', c.name);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_rep_links(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  perform private.ensure_reps();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', t.name, 'token', t.token,
      'invited', (select count(*) from public.rsvp r where lower(trim(r.invited_by)) = t.rep_key),
      'arrived', (select count(distinct r.id) from public.rsvp r where lower(trim(r.invited_by)) = t.rep_key
                    and exists (select 1 from public.checkins c where c.rsvp_id = r.id))
    ) order by lower(t.name))
    from private.rep_tokens t where t.rep_key in (select rep_key from private.current_reps())), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_reset(p_pin text, p_what text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  if p_what in ('checkins','all') then
    delete from public.checkins where true;
    delete from public.leads where true;
    delete from public.phone_aliases where true;
    update private.rep_tokens set last_assigned_at = null where true;
  end if;
  if p_what = 'all' then delete from public.rsvp where true; end if;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_rotate_rep_token(p_pin text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  update private.rep_tokens set token = encode(extensions.gen_random_bytes(18), 'hex') where rep_key = lower(trim(p_name));
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_rsvp_search(p_pin text, p_q text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_digits text := regexp_replace(coalesce(p_q,''), '\D', '', 'g');
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('id', r.id, 'name', r.name, 'phone', r.phone_raw, 'invited_by', r.invited_by,
               'arrived_today', exists (select 1 from public.checkins c where c.rsvp_id = r.id and c.day = v_today)) x
      from public.rsvp r
      where coalesce(trim(p_q),'') = '' or r.name ilike '%' || trim(p_q) || '%' or r.invited_by ilike '%' || trim(p_q) || '%'
         or (v_digits <> '' and r.phone_norm like '%' || v_digits || '%')
      order by r.name limit 25) t), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_save_config(p_pin text, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_cur jsonb;
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  if jsonb_typeof(p_config) <> 'object' or jsonb_typeof(p_config->'questions') <> 'array' then
    return jsonb_build_object('error','invalid config');
  end if;
  select value into v_cur from private.settings where key = 'config';
  if p_config->>'base_version' is distinct from md5(v_cur::text) then
    return jsonb_build_object('error', 'These settings were changed somewhere else, or this page is out of date. The page has been refreshed with the latest values — please re-apply your edit and save again.');
  end if;
  update private.settings set value = p_config - 'base_version' where key = 'config';
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_additional(p_pin text, p_checkin_id bigint, p_additional integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  if p_additional is null or p_additional < 0 or p_additional > 20 then return jsonb_build_object('error','Enter a number from 0 to 20.'); end if;
  update public.checkins set additional = p_additional where id = p_checkin_id;
  if not found then return jsonb_build_object('error','Check-in not found'); end if;
  return jsonb_build_object('ok', true, 'additional', p_additional);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_builder(p_pin text, p_checkin_id bigint, p_builder text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text;
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  if btrim(coalesce(p_builder,'')) = '' then v := null;
  else
    v := private.canon_builder(p_builder);
    if v is null then return jsonb_build_object('error','Unknown builder table'); end if;
  end if;
  update public.checkins set builder = v where id = p_checkin_id;
  if not found then return jsonb_build_object('error','Check-in not found'); end if;
  return jsonb_build_object('ok', true, 'builder', v);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_done(p_pin text, p_checkin_id bigint, p_done boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_by text;
begin
  if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  v_by := case when left(coalesce(p_pin,''),4) = 'obs_' then coalesce((select name from private.observers where token = p_pin),'Observer') else 'Admin' end;
  if coalesce(p_done, true) then
    update public.checkins set done_at = now(), done_by = v_by,
           ack_by = coalesce(ack_by, v_by), ack_at = coalesce(ack_at, now()) where id = p_checkin_id;
  else
    update public.checkins set done_at = null, done_by = null where id = p_checkin_id;
  end if;
  if not found then return jsonb_build_object('error','Check-in not found'); end if;
  return jsonb_build_object('ok', true, 'done', coalesce(p_done, true));
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_invite_days(p_pin text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int;
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  if jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('error','invalid rows'); end if;
  with src as (select private.norm_phone(x->>'phone') p, nullif(x->>'day','')::date d from jsonb_array_elements(p_rows) x),
       u as (update public.rsvp r set invite_day = src.d from src where r.phone_norm = src.p returning 1)
  select count(*) into n from u;
  return jsonb_build_object('ok', true, 'updated', n);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_pin(p_pin text, p_new_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error', 'unauthorized'); end if;
  if char_length(coalesce(p_new_pin, '')) < 6 then return jsonb_build_object('error', 'Use at least 6 characters.'); end if;
  update private.settings set value = to_jsonb(extensions.crypt(p_new_pin, extensions.gen_salt('bf')))
   where key = 'admin_pin_hash';
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_rep_flags(p_pin text, p_name text, p_in_rotation boolean DEFAULT NULL::boolean, p_available boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
  update private.rep_tokens set in_rotation = coalesce(p_in_rotation, in_rotation), available = coalesce(p_available, available)
   where rep_key = lower(trim(p_name));
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.check_in(p_name text, p_phone text, p_prefs jsonb DEFAULT '{}'::jsonb, p_referred_by text DEFAULT NULL::text, p_consent boolean DEFAULT false, p_additional integer DEFAULT 0, p_builder text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ip text := private.client_ip();
begin
  if (select count(*) from private.checkin_attempts where ip = v_ip and at > now() - interval '10 minutes') >= 60 then
    return jsonb_build_object('ok',false,'error','Too many check-ins from this network. Please ask the reception desk for help.');
  end if;
  insert into private.checkin_attempts(ip) values (v_ip);
  delete from private.checkin_attempts where at < now() - interval '1 day';
  return private.do_check_in(p_name, p_phone, p_prefs, p_referred_by, p_consent, p_additional, p_builder) - 'owner';
end $function$
;

CREATE OR REPLACE FUNCTION public.get_event_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (s.value - 'team') || jsonb_build_object(
    'extra_team', coalesce(s.value->'team', '[]'::jsonb),
    'version', md5(s.value::text),
    'team', coalesce((select jsonb_agg(n order by lower(n)) from (
      select distinct on (lower(trim(n))) trim(n) n from (
        select jsonb_array_elements_text(s.value->'team') n
        union all select invited_by from public.rsvp
      ) a where coalesce(trim(n),'') <> ''
      order by lower(trim(n)), n
    ) b), '[]'::jsonb))
  from private.settings s where s.key = 'config'
$function$
;

CREATE OR REPLACE FUNCTION public.get_push_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select value #>> '{}' from private.settings where key = 'vapid_public'
$function$
;

CREATE OR REPLACE FUNCTION public.push_prepare(p_secret text, p_kind text, p_id bigint DEFAULT NULL::bigint, p_rep_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sec text; v_pub text; v_priv text; c public.checkins%rowtype; msgs jsonb := '[]'::jsonb; prefs_line text; v_prior int;
begin
  select value #>> '{}' into v_sec from private.settings where key = 'push_secret';
  if v_sec is null or p_secret is distinct from v_sec then return jsonb_build_object('error','unauthorized'); end if;
  select value #>> '{}' into v_pub from private.settings where key = 'vapid_public';
  select value #>> '{}' into v_priv from private.settings where key = 'vapid_private';
  if v_pub is null or v_priv is null then return jsonb_build_object('need_keys', true); end if;

  if p_kind = 'test' then
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
        'title', '✅ Alerts are working', 'body', 'You will get a notification like this the moment one of your guests checks in.',
        'url', '/rep.html?t=' || t.token, 'tag', 'test')), '[]'::jsonb)
      into msgs from private.push_subs s join private.rep_tokens t using (rep_key) where s.rep_key = p_rep_key;
  elsif p_kind = 'pass' then
    select * into c from public.checkins where id = p_id;
    if found then
      c.name := c.name || case when c.additional > 0 then ' (+' || c.additional || ' with them)' else '' end;
      select string_agg(case when jsonb_typeof(e.v) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(e.v) x) else e.v #>> '{}' end, ' · ')
        into prefs_line from jsonb_each(c.prefs) e(k, v);
      select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
          'title', case when s.rep_key = coalesce(c.assigned_to,'') then '🔔 ' || c.name || ' passed to you'
                        else c.name || ' is now with ' || coalesce((select tt.name from private.rep_tokens tt where tt.rep_key = c.assigned_to), 'a colleague') end,
          'body', case when s.rep_key = coalesce(c.assigned_to,'') then 'Passed on from ' || coalesce(c.passed_from, 'a colleague') || coalesce(' · ' || prefs_line, '')
                       else 'No action needed — a colleague is looking after this guest.' end,
          'url', '/rep.html?t=' || t.token, 'tag', 'pass-' || c.id)), '[]'::jsonb)
        into msgs
        from private.push_subs s join private.rep_tokens t using (rep_key)
        where s.rep_key in (lower(trim(coalesce(c.invited_by,''))), lower(trim(coalesce(c.referred_by,''))), coalesce(c.assigned_to,''), lower(trim(coalesce(c.passed_from,''))));
    end if;

  elsif p_kind = 'checkin' then
    select * into c from public.checkins where id = p_id;
    if found then
      c.name := c.name || case when c.additional > 0 then ' (+' || c.additional || ' with them)' else '' end;
      select string_agg(case when jsonb_typeof(e.v) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(e.v) x) else e.v #>> '{}' end, ' · ')
        into prefs_line from jsonb_each(c.prefs) e(k, v);
      select count(*) into v_prior from public.checkins x where x.phone_norm = c.phone_norm and x.day < c.day;
      select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
          'title', case
              when s.rep_key = lower(trim(coalesce(c.invited_by,''))) then '🔔 ' || c.name || ' has arrived' || case when v_prior > 0 then ' (back again)' else '' end
              when s.rep_key = coalesce(c.assigned_to,'') then '🔔 Walk-in ' || c.name || ' assigned to you'
              when c.status = 'walkin' then '🔔 Walk-in ' || c.name || ' asked for you'
              else '🔔 ' || c.name || ' asked for you' end,
          'body', case
              when s.rep_key = lower(trim(coalesce(c.invited_by,''))) then 'Your invited guest' || coalesce(' · ' || prefs_line, '')
              when s.rep_key = coalesce(c.assigned_to,'') then 'Next in the walk-in rotation' || coalesce(' · ' || prefs_line, '')
              when c.status = 'walkin' then 'Not on the guest list' || coalesce(' · ' || prefs_line, '')
              else 'Invited by ' || coalesce(c.invited_by, 'another rep') || coalesce(' · ' || prefs_line, '') end,
          'url', '/rep.html?t=' || t.token, 'tag', 'checkin-' || c.id)), '[]'::jsonb)
        into msgs
        from private.push_subs s join private.rep_tokens t using (rep_key)
        where s.rep_key in (lower(trim(coalesce(c.invited_by,''))), lower(trim(coalesce(c.referred_by,''))), coalesce(c.assigned_to,''));
    end if;
  end if;
  return jsonb_build_object('vapid_public', v_pub, 'vapid_private', v_priv,
    'subject', (select value #>> '{}' from private.settings where key = 'push_subject'), 'messages', msgs);
end $function$
;

CREATE OR REPLACE FUNCTION public.push_remove(p_secret text, p_endpoint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sec text;
begin
  select value #>> '{}' into v_sec from private.settings where key = 'push_secret';
  if v_sec is null or p_secret is distinct from v_sec then return jsonb_build_object('error','unauthorized'); end if;
  delete from private.push_subs where endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.push_store_keys(p_secret text, p_pub text, p_priv text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sec text;
begin
  select value #>> '{}' into v_sec from private.settings where key = 'push_secret';
  if v_sec is null or p_secret is distinct from v_sec then return jsonb_build_object('error','unauthorized'); end if;
  insert into private.settings(key, value) values ('vapid_public', to_jsonb(p_pub)) on conflict (key) do nothing;
  insert into private.settings(key, value) values ('vapid_private', to_jsonb(p_priv)) on conflict (key) do nothing;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_ack(p_token text, p_checkin_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens; c public.checkins%rowtype;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  select * into c from public.checkins where id = p_checkin_id;
  if not found or t.rep_key not in (lower(trim(coalesce(c.invited_by,''))), lower(trim(coalesce(c.referred_by,''))), coalesce(c.assigned_to,'')) then
    return jsonb_build_object('error','not your guest');
  end if;
  if c.passed_at is not null and c.assigned_to is distinct from t.rep_key then
    return jsonb_build_object('error','This guest was passed to another team member');
  end if;
  update public.checkins set ack_by = t.name, ack_at = now() where id = c.id and ack_at is null;
  return jsonb_build_object('ok', true, 'ack_by', (select ack_by from public.checkins where id = c.id));
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_dashboard(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens%rowtype; v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into t from private.rep_tokens where token = coalesce(p_token, '');
  if not found then return jsonb_build_object('error', 'unauthorized'); end if;
  if t.last_seen is null or t.last_seen < now() - interval '60 seconds' then
    update private.rep_tokens set last_seen = now() where rep_key = t.rep_key;
  end if;
  return jsonb_build_object(
    'name', t.name,
    'event', (select value->>'event_name' from private.settings where key = 'config'),
    'today', v_day, 'builders', coalesce((select value->'builders' from private.settings where key = 'config'), '[]'::jsonb), 'available', t.available, 'in_rotation', t.in_rotation,
    'guests', coalesce((
      select jsonb_agg(q.g order by q.np, q.ts desc nulls last, q.nm)
      from (
        select jsonb_build_object(
          'id', r.id, 'name', r.name, 'phone', r.phone_raw, 'arrived', c.id is not null, 'checkin_id', c.id,
          'at', c.created_at, 'prefs', coalesce(c.prefs, '{}'::jsonb), 'named', c.referred_by,
          'ack_by', c.ack_by, 'ack_at', c.ack_at, 'stage', coalesce(l.stage, 'New'), 'note', l.note,
          'other', (select tt.name from private.rep_tokens tt where tt.rep_key = c.assigned_to and tt.rep_key <> t.rep_key and c.passed_at is not null),
          'passed_from', c.passed_from, 'additional', c.additional, 'builder', c.builder, 'done_at', c.done_at,
          'visits', (select coalesce(jsonb_agg(x.day order by x.day), '[]'::jsonb)
                     from (select distinct c2.day from public.checkins c2 where c2.rsvp_id = r.id and c2.day < v_day) x)
        ) g, (c.id is null) np, c.created_at ts, r.name nm
        from public.rsvp r
        left join public.checkins c on c.rsvp_id = r.id and c.day = v_day
        left join public.leads l on l.phone_norm = r.phone_norm
        where lower(trim(r.invited_by)) = t.rep_key and (r.invite_day is null or r.invite_day = v_day or c.id is not null or not exists (select 1 from public.rsvp z where z.invite_day = v_day))
      ) q), '[]'::jsonb),
    'named_me', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'phone', c.phone_raw, 'status', c.status, 'invited_by', c.invited_by,
        'assigned', c.assigned_to = t.rep_key, 'day', c.day, 'at', c.created_at, 'prefs', c.prefs,
        'ack_by', c.ack_by, 'ack_at', c.ack_at, 'stage', coalesce(l.stage, 'New'), 'note', l.note,
        'other', (select tt.name from private.rep_tokens tt where tt.rep_key = c.assigned_to and tt.rep_key <> t.rep_key and c.passed_at is not null),
        'passed_from', c.passed_from, 'additional', c.additional, 'builder', c.builder, 'done_at', c.done_at)
        order by c.created_at desc)
      from public.checkins c
      left join public.leads l on l.phone_norm = coalesce((select x.phone_norm from public.rsvp x where x.id = c.rsvp_id), c.phone_norm)
      where (lower(trim(c.referred_by)) = t.rep_key and (c.status = 'walkin' or lower(trim(coalesce(c.invited_by, ''))) <> t.rep_key))
         or c.assigned_to = t.rep_key), '[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_dashboard_day(p_token text, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens%rowtype; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_day date;
begin
  select * into t from private.rep_tokens where token = coalesce(p_token, '');
  if not found then return jsonb_build_object('error', 'unauthorized'); end if;
  v_day := coalesce(p_day, v_today);
  return jsonb_build_object(
    'name', t.name,
    'today', v_today, 'day', v_day,
    'days', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from (
               select day d from public.checkins union select invite_day from public.rsvp where invite_day is not null union select v_today) z),
    'builders', coalesce((select value->'builders' from private.settings where key = 'config'), '[]'::jsonb),
    'guests', coalesce((
      select jsonb_agg(q.g order by q.np, q.ts desc nulls last, q.nm)
      from (
        select jsonb_build_object(
          'id', r.id, 'name', r.name, 'phone', r.phone_raw, 'arrived', c.id is not null, 'checkin_id', c.id,
          'at', c.created_at, 'prefs', coalesce(c.prefs, '{}'::jsonb), 'named', c.referred_by,
          'ack_by', c.ack_by, 'ack_at', c.ack_at, 'stage', coalesce(l.stage, 'New'), 'note', l.note,
          'other', (select tt.name from private.rep_tokens tt where tt.rep_key = c.assigned_to and tt.rep_key <> t.rep_key and c.passed_at is not null),
          'passed_from', c.passed_from, 'additional', c.additional, 'builder', c.builder, 'done_at', c.done_at,
          'visits', (select coalesce(jsonb_agg(x.day order by x.day), '[]'::jsonb)
                     from (select distinct c2.day from public.checkins c2 where c2.rsvp_id = r.id and c2.day <> v_day) x)
        ) g, (c.id is null) np, c.created_at ts, r.name nm
        from public.rsvp r
        left join public.checkins c on c.rsvp_id = r.id and c.day = v_day
        left join public.leads l on l.phone_norm = r.phone_norm
        where lower(trim(r.invited_by)) = t.rep_key and (r.invite_day is null or r.invite_day = v_day or c.id is not null or not exists (select 1 from public.rsvp z where z.invite_day = v_day))
      ) q), '[]'::jsonb),
    'named_me', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'phone', c.phone_raw, 'status', c.status, 'invited_by', c.invited_by,
        'assigned', c.assigned_to = t.rep_key, 'day', c.day, 'at', c.created_at, 'prefs', c.prefs,
        'ack_by', c.ack_by, 'ack_at', c.ack_at, 'stage', coalesce(l.stage, 'New'), 'note', l.note,
        'other', (select tt.name from private.rep_tokens tt where tt.rep_key = c.assigned_to and tt.rep_key <> t.rep_key and c.passed_at is not null),
        'passed_from', c.passed_from, 'additional', c.additional, 'builder', c.builder, 'done_at', c.done_at)
        order by c.created_at desc)
      from public.checkins c
      left join public.leads l on l.phone_norm = coalesce((select x.phone_norm from public.rsvp x where x.id = c.rsvp_id), c.phone_norm)
      where c.day = v_day
        and ((lower(trim(c.referred_by)) = t.rep_key and (c.status = 'walkin' or lower(trim(coalesce(c.invited_by, ''))) <> t.rep_key))
         or c.assigned_to = t.rep_key)), '[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(coalesce(p_p256dh,'')) not between 60 and 120
     or length(coalesce(p_auth,'')) not between 16 and 40 then
    return jsonb_build_object('error','invalid subscription');
  end if;
  insert into private.push_subs(rep_key, endpoint, p256dh, auth, ua)
    values (t.rep_key, p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set rep_key = excluded.rep_key, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua;
  -- keep at most 6 devices per rep
  delete from private.push_subs where rep_key = t.rep_key and id not in
    (select id from private.push_subs where rep_key = t.rep_key order by created_at desc limit 6);
  return jsonb_build_object('ok', true, 'devices', (select count(*) from private.push_subs where rep_key = t.rep_key));
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_push_test(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens; v_secret text; v_ip text := private.client_ip(); n int;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  if (select count(*) from private.checkin_attempts where ip = 'test:' || v_ip and at > now() - interval '1 minute') >= 3 then
    return jsonb_build_object('error','Please wait a moment before sending another test.');
  end if;
  insert into private.checkin_attempts(ip) values ('test:' || v_ip);
  select count(*) into n from private.push_subs where rep_key = t.rep_key;
  if n = 0 then return jsonb_build_object('ok', false, 'devices', 0); end if;
  select value #>> '{}' into v_secret from private.settings where key = 'push_secret';
  perform net.http_post(
    url := private.push_url(),
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_secret),
    body := jsonb_build_object('kind','test','rep_key', t.rep_key), timeout_milliseconds := 8000);
  return jsonb_build_object('ok', true, 'devices', n);
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_push_unsubscribe(p_token text, p_endpoint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  delete from private.push_subs where rep_key = t.rep_key and endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_set_additional(p_token text, p_checkin_id bigint, p_additional integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens; c public.checkins%rowtype;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  if p_additional is null or p_additional < 0 or p_additional > 20 then return jsonb_build_object('error','Enter a number from 0 to 20.'); end if;
  select * into c from public.checkins where id = p_checkin_id;
  if not found or t.rep_key not in (lower(trim(coalesce(c.invited_by,''))), lower(trim(coalesce(c.referred_by,''))), coalesce(c.assigned_to,'')) then
    return jsonb_build_object('error','not your guest');
  end if;
  update public.checkins set additional = p_additional where id = c.id;
  return jsonb_build_object('ok', true, 'additional', p_additional);
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_set_available(p_token text, p_available boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  update private.rep_tokens set available = coalesce(p_available, true) where rep_key = t.rep_key;
  return jsonb_build_object('ok', true, 'available', coalesce(p_available, true));
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_set_builder(p_token text, p_checkin_id bigint, p_builder text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens; c public.checkins%rowtype; v text;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  select * into c from public.checkins where id = p_checkin_id;
  if not found or t.rep_key not in (lower(trim(coalesce(c.invited_by,''))), lower(trim(coalesce(c.referred_by,''))), coalesce(c.assigned_to,'')) then
    return jsonb_build_object('error','not your guest');
  end if;
  if btrim(coalesce(p_builder,'')) = '' then v := null;
  else
    v := private.canon_builder(p_builder);
    if v is null then return jsonb_build_object('error','Unknown builder table'); end if;
  end if;
  update public.checkins set builder = v where id = c.id;
  return jsonb_build_object('ok', true, 'builder', v);
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_set_done(p_token text, p_checkin_id bigint, p_done boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens; c public.checkins%rowtype;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  select * into c from public.checkins where id = p_checkin_id;
  if not found or t.rep_key not in (lower(trim(coalesce(c.invited_by,''))), lower(trim(coalesce(c.referred_by,''))), coalesce(c.assigned_to,'')) then
    return jsonb_build_object('error','not your guest');
  end if;
  if c.passed_at is not null and c.assigned_to is distinct from t.rep_key then
    return jsonb_build_object('error','This guest was passed to another team member');
  end if;
  if coalesce(p_done, true) then
    -- finishing a guest also counts as handled, so they leave the "waiting" list
    update public.checkins set done_at = now(), done_by = t.name,
           ack_by = coalesce(ack_by, t.name), ack_at = coalesce(ack_at, now()) where id = c.id;
  else
    update public.checkins set done_at = null, done_by = null where id = c.id;
  end if;
  return jsonb_build_object('ok', true, 'done', coalesce(p_done, true));
end $function$
;

CREATE OR REPLACE FUNCTION public.rep_set_lead(p_token text, p_kind text, p_id bigint, p_stage text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.rep_tokens; v_key text; c public.checkins%rowtype;
begin
  t := private.rep_from_token(p_token);
  if t.rep_key is null then return jsonb_build_object('error','unauthorized'); end if;
  if p_stage not in ('New','Yet To Talk','Followup','Hot','Cold','Converted','Lost','Warm') then
    return jsonb_build_object('error','invalid stage');
  end if;
  if p_kind = 'rsvp' then
    select r.phone_norm into v_key from public.rsvp r where r.id = p_id and lower(trim(r.invited_by)) = t.rep_key;
  elsif p_kind = 'checkin' then
    select * into c from public.checkins where id = p_id;
    if found and t.rep_key in (lower(trim(coalesce(c.invited_by,''))), lower(trim(coalesce(c.referred_by,''))), coalesce(c.assigned_to,'')) then
      v_key := coalesce((select r.phone_norm from public.rsvp r where r.id = c.rsvp_id), c.phone_norm);
    end if;
  end if;
  if v_key is null then return jsonb_build_object('error','not your guest'); end if;
  insert into public.leads(phone_norm, stage, note, updated_by, updated_at)
    values (v_key, p_stage, nullif(left(trim(coalesce(p_note,'')), 600), ''), t.name, now())
  on conflict (phone_norm) do update set stage = excluded.stage, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.viewer_login(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text;
begin
  if left(coalesce(p_pin, ''), 4) = 'obs_' then
    update private.observers set last_seen = now() where token = p_pin returning name into v_name;
    if v_name is null then return jsonb_build_object('ok', false); end if;
    return jsonb_build_object('ok', true, 'role', 'observer', 'name', v_name);
  end if;
  if private.is_admin(p_pin) then return jsonb_build_object('ok', true, 'role', 'admin'); end if;
  return jsonb_build_object('ok', false);
end $function$
;

-- ---------- triggers ----------
CREATE TRIGGER checkins_flag_similar BEFORE INSERT ON public.checkins FOR EACH ROW EXECUTE FUNCTION private.flag_similar();
CREATE TRIGGER trg_notify_checkin AFTER INSERT ON public.checkins FOR EACH ROW EXECUTE FUNCTION private.notify_checkin();

-- ---------- grants ----------
-- Lock everything down, then open only the RPC surface.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant execute on function public.admin_dashboard(text, date) to anon, authenticated, service_role;
grant execute on function public.admin_delete_checkin(text, bigint) to anon, authenticated, service_role;
grant execute on function public.admin_import_rsvp(text, jsonb, boolean) to anon, authenticated, service_role;
grant execute on function public.admin_link_checkin(text, bigint, bigint) to anon, authenticated, service_role;
grant execute on function public.admin_login(text) to anon, authenticated, service_role;
grant execute on function public.admin_manual_checkin(text, bigint, integer) to anon, authenticated, service_role;
grant execute on function public.admin_manual_walkin(text, text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.admin_merge_checkin(text, bigint, bigint) to anon, authenticated, service_role;
grant execute on function public.admin_observer_add(text, text) to anon, authenticated, service_role;
grant execute on function public.admin_observer_remove(text, text) to anon, authenticated, service_role;
grant execute on function public.admin_observer_rotate(text, text) to anon, authenticated, service_role;
grant execute on function public.admin_observers(text) to anon, authenticated, service_role;
grant execute on function public.admin_reassign(text, bigint, text) to anon, authenticated, service_role;
grant execute on function public.admin_rep_links(text) to anon, authenticated, service_role;
grant execute on function public.admin_reset(text, text) to anon, authenticated, service_role;
grant execute on function public.admin_rotate_rep_token(text, text) to anon, authenticated, service_role;
grant execute on function public.admin_rsvp_search(text, text) to anon, authenticated, service_role;
grant execute on function public.admin_save_config(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.admin_set_additional(text, bigint, integer) to anon, authenticated, service_role;
grant execute on function public.admin_set_builder(text, bigint, text) to anon, authenticated, service_role;
grant execute on function public.admin_set_done(text, bigint, boolean) to anon, authenticated, service_role;
grant execute on function public.admin_set_invite_days(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.admin_set_pin(text, text) to anon, authenticated, service_role;
grant execute on function public.admin_set_rep_flags(text, text, boolean, boolean) to anon, authenticated, service_role;
grant execute on function public.check_in(text, text, jsonb, text, boolean, integer, text) to anon, authenticated, service_role;
grant execute on function public.get_event_config() to anon, authenticated, service_role;
grant execute on function public.get_push_key() to anon, authenticated, service_role;
grant execute on function public.rep_ack(text, bigint) to anon, authenticated, service_role;
grant execute on function public.rep_dashboard(text) to anon, authenticated, service_role;
grant execute on function public.rep_dashboard_day(text, date) to anon, authenticated, service_role;
grant execute on function public.rep_push_subscribe(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.rep_push_test(text) to anon, authenticated, service_role;
grant execute on function public.rep_push_unsubscribe(text, text) to anon, authenticated, service_role;
grant execute on function public.rep_set_additional(text, bigint, integer) to anon, authenticated, service_role;
grant execute on function public.rep_set_available(text, boolean) to anon, authenticated, service_role;
grant execute on function public.rep_set_builder(text, bigint, text) to anon, authenticated, service_role;
grant execute on function public.rep_set_done(text, bigint, boolean) to anon, authenticated, service_role;
grant execute on function public.rep_set_lead(text, text, bigint, text, text) to anon, authenticated, service_role;
grant execute on function public.viewer_login(text) to anon, authenticated, service_role;
grant execute on function public.push_prepare(text, text, bigint, text) to service_role;
grant execute on function public.push_remove(text, text) to service_role;
grant execute on function public.push_store_keys(text, text, text) to service_role;
