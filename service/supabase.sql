-- ============================================================
-- Espace famille — Académie de voltige équestre
-- ------------------------------------------------------------
-- À coller UNE FOIS dans Supabase : menu « SQL Editor » →
-- « New query » → coller tout ce fichier → bouton « Run ».
--
-- Il crée la table qui garde le carnet de chaque famille
-- (responsable légal + voltigeurs), avec la règle de sécurité :
-- chaque compte ne voit et ne modifie QUE sa propre famille.
-- ============================================================

create table if not exists public.familles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email   text,
  donnees jsonb not null default '{}'::jsonb,
  maj     timestamptz not null default now()
);

alter table public.familles enable row level security;

drop policy if exists "lire sa famille" on public.familles;
create policy "lire sa famille" on public.familles
  for select using (auth.uid() = user_id);

drop policy if exists "creer sa famille" on public.familles;
create policy "creer sa famille" on public.familles
  for insert with check (auth.uid() = user_id);

drop policy if exists "modifier sa famille" on public.familles;
create policy "modifier sa famille" on public.familles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- la date de mise à jour se remplit toute seule
create or replace function public.familles_maj()
returns trigger language plpgsql as $$
begin
  new.maj := now();
  return new;
end $$;

drop trigger if exists familles_maj on public.familles;
create trigger familles_maj
  before update on public.familles
  for each row execute function public.familles_maj();
