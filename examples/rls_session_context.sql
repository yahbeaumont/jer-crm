-- Example 1: session context and fail-closed row level security.
--
-- Generic illustration written for this repository. It is not the product
-- schema: names, table and policy are invented.
--
-- Demonstrates:
--   * an application role that cannot bypass policies;
--   * actor context written with set_config(..., true), local to a transaction;
--   * a policy that matches nothing when the context is absent;
--   * the context disappearing at commit, on a reused connection.
--
-- Run as a superuser on a scratch database:
--   psql -d scratch -f rls_session_context.sql
-- Requires PostgreSQL 14 or newer. The script removes what a previous run
-- may have left and drops what it creates.

drop table if exists task_item;
drop function if exists current_actor();
drop role if exists example_app;

create role example_app login password 'example-only' nosuperuser nobypassrls;

create table task_item (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title    text not null
);

insert into task_item (owner_id, title) values
  ('11111111-1111-4111-8111-111111111111', 'belongs to the first actor'),
  ('22222222-2222-4222-8222-222222222222', 'belongs to the second actor');

-- Reads the actor from the transaction settings. Returns null when absent,
-- which is what makes every policy fail closed.
create function current_actor() returns uuid
language sql stable as $$
  select nullif(current_setting('app.actor_id', true), '')::uuid;
$$;

revoke all on function current_actor() from public;
grant execute on function current_actor() to example_app;

alter table task_item enable row level security;

create policy task_item_read on task_item
  for select using (owner_id = current_actor());

create policy task_item_insert on task_item
  for insert with check (owner_id = current_actor());

grant select, insert on task_item to example_app;

-- From here on, the session behaves like the application.
set role example_app;

-- No context: zero rows, no error.
select 'no context' as scenario, count(*) as visible_rows from task_item;

-- Context for one transaction only.
begin;
select set_config('app.actor_id', '11111111-1111-4111-8111-111111111111', true);
select 'actor one' as scenario, count(*) as visible_rows from task_item;
commit;

-- The setting was local, so it is gone once the transaction ends.
select 'after commit' as scenario, count(*) as visible_rows from task_item;

-- A write outside the actor's scope is rejected by the policy. The block
-- keeps the script running so the cleanup below still executes.
do $$
begin
  insert into task_item (owner_id, title)
  values ('22222222-2222-4222-8222-222222222222', 'attempt from the wrong actor');
  raise notice 'unexpected: the write was accepted';
exception when insufficient_privilege then
  raise notice 'expected: the policy rejected the write';
end $$;

reset role;

drop table task_item;
drop function current_actor();
drop role example_app;
