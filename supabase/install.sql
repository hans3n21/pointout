-- Run once in each app's Supabase project after reviewing existing names.
-- PointOut browser clients never receive the service-role/secret key.
create table public.pointout_feedback (
  id uuid primary key,
  project_id text not null check (length(btrim(project_id)) between 1 and 100),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'triaged', 'resolved')),
  feedback_text text not null check (length(btrim(feedback_text)) between 1 and 4000),
  transcript_original text,
  screenshot_url text,
  annotation_data jsonb not null default '{"version":1,"marks":[]}'::jsonb,
  page_url text,
  route text,
  browser text,
  browser_version text,
  operating_system text,
  operating_system_version text,
  device_type text check (device_type in ('mobile', 'tablet', 'desktop')),
  viewport jsonb,
  screen_size jsonb,
  pixel_ratio numeric,
  touch_enabled boolean,
  display_mode text check (display_mode in ('standalone', 'browser')),
  app_version text,
  metadata jsonb not null default '{}'::jsonb
);

create index pointout_feedback_project_created_idx on public.pointout_feedback (project_id, created_at desc);
alter table public.pointout_feedback enable row level security;
revoke all on public.pointout_feedback from anon, authenticated;
grant select, insert, update, delete on public.pointout_feedback to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pointout-feedback', 'pointout-feedback', false, 6291456, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policy is added: only the server's service role may upload/read.

create table public.pointout_rate_limit (
  project_id text not null,
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  uses integer not null default 1,
  primary key (project_id, scope, key_hash, window_start)
);
create index pointout_rate_limit_window_idx on public.pointout_rate_limit (window_start);
alter table public.pointout_rate_limit enable row level security;
revoke all on public.pointout_rate_limit from anon, authenticated;
grant select, insert, update, delete on public.pointout_rate_limit to service_role;

create function public.pointout_claim_request(
  p_project_id text, p_scope text, p_key_hash text, p_window_seconds integer, p_limit integer
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  current_uses integer;
  bucket_start timestamptz;
begin
  if p_window_seconds < 60 or p_window_seconds > 86400 or p_limit < 1 or p_limit > 1000 then
    return false;
  end if;
  bucket_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.pointout_rate_limit (project_id, scope, key_hash, window_start, uses)
  values (p_project_id, p_scope, p_key_hash, bucket_start, 1)
  on conflict (project_id, scope, key_hash, window_start)
  do update set uses = public.pointout_rate_limit.uses + 1
  returning uses into current_uses;
  return current_uses <= p_limit;
end;
$$;
revoke all on function public.pointout_claim_request(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.pointout_claim_request(text, text, text, integer, integer) to service_role;
