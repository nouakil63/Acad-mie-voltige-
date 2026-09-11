-- Prérequis : service/supabase.sql et service/supabase-admin.sql déjà installés.
-- Exécuter avec le rôle propriétaire des tables. Aucun appel externe.
-- Cette transaction déplace les notes hors des lignes lisibles par les familles.
begin;

lock table public.familles in access exclusive mode;

create table if not exists public.notes_familles (
  user_id uuid primary key references public.familles(user_id) on delete cascade,
  note text not null default '',
  maj timestamptz not null default now(),
  auteur uuid references auth.users(id) on delete set null
);

alter table public.notes_familles enable row level security;
revoke all on public.notes_familles from anon;
grant select, insert, update, delete on public.notes_familles to authenticated;

drop policy if exists "les admins gerent les notes familles" on public.notes_familles;
create policy "les admins gerent les notes familles" on public.notes_familles
  for all to authenticated
  using (exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')));

-- Le bloc conditionnel permet de rejouer la migration après son installation.
-- Si une note existe déjà dans la nouvelle table, conserver les deux textes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'familles' and column_name = 'note_admin'
  ) then
    execute $copie$
      insert into public.notes_familles (user_id, note, maj)
      select user_id, note_admin, maj from public.familles
      where note_admin is not null and btrim(note_admin) <> ''
      on conflict (user_id) do update set
        note = case
          when notes_familles.note = excluded.note then notes_familles.note
          when btrim(notes_familles.note) = '' then excluded.note
          else notes_familles.note || E'\n\n--- Note antérieure importée ---\n' || excluded.note
        end,
        maj = greatest(notes_familles.maj, excluded.maj)
    $copie$;
    alter table public.familles drop column note_admin;
  end if;
end $$;

-- Les admins annotent la table dédiée ; ce droit large sur familles n'est plus utile.
drop policy if exists "les admins annotent les familles" on public.familles;

create or replace function public.notes_familles_maj()
returns trigger language plpgsql set search_path = public as $$
begin
  new.maj := now();
  new.auteur := auth.uid();
  return new;
end $$;

drop trigger if exists notes_familles_maj on public.notes_familles;
create trigger notes_familles_maj
  before insert or update on public.notes_familles
  for each row execute function public.notes_familles_maj();

commit;
