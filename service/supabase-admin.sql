-- ============================================================
-- Espace académie (administration) — Académie de voltige
-- ------------------------------------------------------------
-- À coller UNE FOIS dans Supabase : menu « SQL Editor » →
-- « New query » → coller tout ce fichier → bouton « Run ».
--
-- Il crée :
--  · la table qui garde TOUTES les demandes d'inscription
--    (remplie par le service Google à chaque demande reçue),
--  · la liste des adresses « admin » : seuls ces comptes voient
--    les demandes et peuvent les valider ou les refuser depuis
--    la page admin.html du site.
-- ============================================================

create table if not exists public.demandes (
  id           uuid primary key default gen_random_uuid(),
  cree         timestamptz not null default now(),
  type         text,
  enfant       text,
  parent_nom   text,
  parent_email text,
  detail       text,
  tarif        text,
  lignes       text,
  jeton_d      text,
  jeton_s      text,
  statut       text not null default 'en attente',
  decide       timestamptz
);

alter table public.demandes enable row level security;

-- Les adresses qui ont accès à l'espace académie.
-- Pour ajouter quelqu'un plus tard, relancez simplement :
--   insert into public.admins (email) values ('adresse@exemple.fr');
create table if not exists public.admins (email text primary key);
insert into public.admins (email) values
  ('academiedevoltige@gmail.com'),
  ('normanouakil63@gmail.com')
on conflict do nothing;

alter table public.admins enable row level security;

drop policy if exists "voir si je suis admin" on public.admins;
create policy "voir si je suis admin" on public.admins
  for select using (email = (auth.jwt() ->> 'email'));

drop policy if exists "les admins lisent les demandes" on public.demandes;
create policy "les admins lisent les demandes" on public.demandes
  for select using (
    exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))
  );

drop policy if exists "les admins classent les demandes" on public.demandes;
create policy "les admins classent les demandes" on public.demandes
  for update using (
    exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))
  ) with check (
    exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))
  );
