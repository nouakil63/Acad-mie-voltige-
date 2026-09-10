-- CRM v22 : registre des encaissements Stripe et rapprochement atomique.
-- Exécuter après supabase-admin.sql, AVANT de publier service/Code.gs v22.
-- Aucune modification des règlements déjà saisis ; les sessions historiques
-- dont l'affectation est incertaine restent à vérifier dans Stripe.
begin;

create table if not exists public.crm_paiements_stripe (
  session_id text primary key check (session_id ~ '^cs_[A-Za-z0-9_]+$'),
  email text not null check (email = lower(btrim(email)) and length(email) > 3),
  montant_centimes bigint not null check (montant_centimes > 0),
  devise text not null check (devise = 'eur'),
  -- Checkout Session.created : repère de date, pas date de versement bancaire.
  recu_le timestamptz not null,
  importe_le timestamptz not null default now(),
  demande_id uuid references public.demandes(id) on delete restrict,
  nature text check (nature in ('total', 'acompte', 'solde')),
  rapproche_le timestamptz,
  rapproche_par text,
  check ((demande_id is null and nature is null and rapproche_le is null)
    or (demande_id is not null and nature is not null and rapproche_le is not null))
);

create index if not exists crm_paiements_stripe_demande_idx
  on public.crm_paiements_stripe(demande_id) where demande_id is not null;
create index if not exists crm_paiements_stripe_recu_idx
  on public.crm_paiements_stripe(recu_le, session_id);
alter table public.crm_paiements_stripe enable row level security;
revoke all on public.crm_paiements_stripe from public, anon, authenticated, service_role;
grant select on public.crm_paiements_stripe to authenticated;
-- Le service importe les faits Stripe ; seule la RPC affecte un paiement.
grant select, insert on public.crm_paiements_stripe to service_role;
drop policy if exists "admins lisent le registre Stripe" on public.crm_paiements_stripe;
create policy "admins lisent le registre Stripe" on public.crm_paiements_stripe
  for select to authenticated using (
    exists (select 1 from public.admins a where lower(a.email) = lower(auth.jwt() ->> 'email'))
  );

-- Montants français : 25 €, 325,50 €, 1 200 €. Pas d'arrondi à l'euro.
create or replace function public.crm_montant_centimes(p_tarif text)
returns bigint language plpgsql immutable set search_path = '' as $$
declare v_nombre text;
begin
  v_nombre := substring(replace(replace(replace(coalesce(p_tarif, ''), ' ', ''), chr(160), ''), chr(8239), '')
    from '([0-9]+([.,][0-9]{1,2})?)');
  if v_nombre is null then return 0; end if;
  return round(replace(v_nombre, ',', '.')::numeric * 100)::bigint;
end;
$$;

-- Les verrous sur la session puis la demande empêchent deux onglets ou la
-- routine quotidienne de consommer le même règlement simultanément.
create or replace function public.crm_appliquer_paiement_stripe(
  p_demande_id uuid, p_session_id text, p_acteur text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.crm_paiements_stripe%rowtype;
  v_d public.demandes%rowtype;
  v_total bigint;
  v_solde bigint;
  v_nature text;
  v_jour date;
  v_acteur text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not exists (
    select 1 from public.admins a where lower(a.email) = lower(auth.jwt() ->> 'email')
  ) then raise exception using message = 'acces_refuse', errcode = '42501'; end if;
  v_acteur := case when auth.role() = 'service_role' then coalesce(nullif(p_acteur, ''), 'routine')
    else auth.jwt() ->> 'email' end;

  select * into v_p from public.crm_paiements_stripe where session_id = p_session_id for update;
  if not found then raise exception 'paiement_introuvable'; end if;
  if v_p.demande_id is not null and v_p.demande_id <> p_demande_id then
    raise exception 'paiement_deja_affecte';
  end if;
  select * into v_d from public.demandes where id = p_demande_id for update;
  if not found then raise exception 'demande_introuvable'; end if;
  -- Une répétition sur le même couple rend l'état enregistré, sans réécriture.
  if v_p.demande_id = p_demande_id then
    return jsonb_build_object('ok', true, 'deja_rapproche', true,
      'demande', to_jsonb(v_d), 'paiement', to_jsonb(v_p));
  end if;
  if coalesce(v_d.annule, false) then raise exception 'demande_annulee'; end if;
  if v_d.statut <> 'validée' then raise exception 'demande_non_validee'; end if;
  if lower(btrim(coalesce(v_d.parent_email, ''))) <> v_p.email then raise exception 'email_incompatible'; end if;
  if v_p.devise <> 'eur' then raise exception 'devise_incompatible'; end if;
  if v_p.recu_le < date_trunc('second', v_d.cree) then raise exception 'paiement_anterieur_demande'; end if;
  if v_p.recu_le > now() + interval '5 minutes' then raise exception 'date_paiement_invalide'; end if;
  if coalesce(v_d.paye, false) then raise exception 'demande_deja_payee'; end if;
  v_total := public.crm_montant_centimes(v_d.tarif);
  if v_total = 0 and v_d.type = 'stage' then v_total := 84000; end if;
  if v_total <= 0 then raise exception 'tarif_invalide'; end if;
  v_jour := (v_p.recu_le at time zone 'Europe/Paris')::date;
  if v_d.type = 'stage' then
    v_solde := v_total - 30000;
    if not coalesce(v_d.acompte_paye, false) and not coalesce(v_d.solde_paye, false) and v_p.montant_centimes = v_total then
      v_nature := 'total';
    elsif not coalesce(v_d.acompte_paye, false) and not coalesce(v_d.solde_paye, false)
      and v_solde > 0 and v_p.montant_centimes = 30000 then
      v_nature := 'acompte';
    elsif coalesce(v_d.acompte_paye, false) and not coalesce(v_d.solde_paye, false)
      and v_solde > 0 and v_p.montant_centimes = v_solde then
      v_nature := 'solde';
    else raise exception 'montant_ou_etat_incompatible'; end if;
  elsif v_d.type = 'cours' and v_p.montant_centimes = v_total then
    v_nature := 'total';
  else raise exception 'montant_ou_etat_incompatible'; end if;

  -- Une remise à zéro manuelle des cases du CRM ne rend jamais une session
  -- réutilisable et ne permet pas un deuxième acompte / règlement total.
  if exists (select 1 from public.crm_paiements_stripe p where p.demande_id = p_demande_id
    and (v_nature in ('total', 'acompte') or p.nature in ('total', 'solde'))) then
    raise exception 'paiement_etat_registre_incompatible';
  end if;
  if (select coalesce(sum(p.montant_centimes), 0) from public.crm_paiements_stripe p
    where p.demande_id = p_demande_id) + v_p.montant_centimes > v_total then
    raise exception 'paiement_depasse_tarif';
  end if;

  update public.demandes set
    acompte_paye = case when type = 'stage' and v_nature in ('total','acompte') then true else acompte_paye end,
    acompte_le = case when type = 'stage' and v_nature in ('total','acompte') then v_jour else acompte_le end,
    solde_paye = case when type = 'stage' and v_nature in ('total','solde') then true else solde_paye end,
    solde_le = case when type = 'stage' and v_nature in ('total','solde') then v_jour else solde_le end,
    paye = case when v_nature in ('total','solde') then true else paye end,
    paye_le = case when v_nature in ('total','solde') then v_jour else paye_le end,
    paye_montant = case when v_nature in ('total','solde') then (v_total::numeric / 100)::text || ' €' else paye_montant end
  where id = p_demande_id returning * into v_d;
  update public.crm_paiements_stripe set demande_id = p_demande_id, nature = v_nature,
    rapproche_le = now(), rapproche_par = v_acteur where session_id = p_session_id returning * into v_p;
  return jsonb_build_object('ok', true, 'deja_rapproche', false,
    'demande', to_jsonb(v_d), 'paiement', to_jsonb(v_p));
end;
$$;

revoke all on function public.crm_montant_centimes(text) from public, anon, authenticated;
revoke all on function public.crm_appliquer_paiement_stripe(uuid,text,text) from public, anon;
grant execute on function public.crm_appliquer_paiement_stripe(uuid,text,text) to authenticated, service_role;

-- Journal technique des décisions signées. La signature seule est conservée,
-- jamais les renseignements du jeton. Une réservation unique précède l'e-mail
-- pour empêcher la répétition après un double clic ou un arrêt du script.
create table if not exists public.crm_decisions (
  jeton_signature text primary key,
  action text not null check (action in ('valider', 'refuser')),
  statut_cible text not null,
  etat text not null default 'reserve' check (etat in ('reserve', 'envoye', 'termine')),
  cree timestamptz not null default now(),
  envoye_le timestamptz,
  termine_le timestamptz
);
alter table public.crm_decisions enable row level security;
revoke all on public.crm_decisions from public, anon, authenticated, service_role;
grant select, insert, update on public.crm_decisions to service_role;

commit;
