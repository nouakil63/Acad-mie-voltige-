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

-- La base clients : les admins voient toutes les familles enregistrées.
drop policy if exists "les admins lisent les familles" on public.familles;
create policy "les admins lisent les familles" on public.familles
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

-- Suivi des paiements : l'académie note sur chaque demande validée
-- si elle a été réglée (et combien). Rappel maison : le trimestre est
-- dû, que le voltigeur vienne ou non.
alter table public.demandes add column if not exists paye boolean not null default false;
alter table public.demandes add column if not exists paye_le date;
alter table public.demandes add column if not exists paye_montant text;

-- Les stages se règlent en deux temps : acompte de 300 € à
-- l'inscription, solde au plus tard 30 jours avant le stage.
-- Et une annulation peut donner lieu à un remboursement, de 0 €
-- jusqu'à la totalité, au choix de l'académie.
alter table public.demandes add column if not exists acompte_paye boolean not null default false;
alter table public.demandes add column if not exists acompte_le date;
alter table public.demandes add column if not exists solde_paye boolean not null default false;
alter table public.demandes add column if not exists solde_le date;
alter table public.demandes add column if not exists annule boolean not null default false;
alter table public.demandes add column if not exists annule_le date;
alter table public.demandes add column if not exists rembourse_montant text;

-- ============================================================
-- Les trimestres et les réservations de cours
-- ------------------------------------------------------------
-- Quand un parent a payé son trimestre, l'académie l'active depuis
-- la plateforme (base clients → « Activer un trimestre »). Le parent
-- réserve ensuite ses cours depuis Mon compte : UN cours par semaine
-- maximum (mercredi ou samedi), uniquement entre le début et la fin
-- du trimestre. Ces règles sont verrouillées ici, dans la base.
-- ============================================================

create table if not exists public.abonnements (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email   text,
  enfant  text,
  debut   date not null,
  fin     date not null,
  cree    timestamptz not null default now()
);

alter table public.abonnements enable row level security;

drop policy if exists "voir mes trimestres" on public.abonnements;
create policy "voir mes trimestres" on public.abonnements
  for select using (user_id = auth.uid());

drop policy if exists "les admins gerent les trimestres" on public.abonnements;
create policy "les admins gerent les trimestres" on public.abonnements
  for all using (
    exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))
  ) with check (
    exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))
  );

create table if not exists public.reservations (
  id             uuid primary key default gen_random_uuid(),
  abonnement_id  uuid not null references public.abonnements (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email          text,
  enfant         text,
  jour           text,
  date           date not null,
  semaine        text not null,
  cree           timestamptz not null default now(),
  unique (abonnement_id, semaine)  -- le verrou : un seul cours par semaine
);

alter table public.reservations enable row level security;

drop policy if exists "voir mes reservations" on public.reservations;
create policy "voir mes reservations" on public.reservations
  for select using (user_id = auth.uid());

drop policy if exists "reserver dans mon trimestre" on public.reservations;
create policy "reserver dans mon trimestre" on public.reservations
  for insert with check (
    user_id = auth.uid()
    and date >= current_date
    and exists (
      select 1 from public.abonnements a
      where a.id = abonnement_id
        and a.user_id = auth.uid()
        and reservations.date >= a.debut
        and reservations.date <= a.fin
    )
  );

drop policy if exists "annuler une reservation a venir" on public.reservations;
create policy "annuler une reservation a venir" on public.reservations
  for delete using (user_id = auth.uid() and date > current_date);

drop policy if exists "les admins voient les reservations" on public.reservations;
create policy "les admins voient les reservations" on public.reservations
  for select using (
    exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))
  );

drop policy if exists "les admins retirent une reservation" on public.reservations;
create policy "les admins retirent une reservation" on public.reservations
  for delete using (
    exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))
  );
