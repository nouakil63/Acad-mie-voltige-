-- CRM v23 : le moyen de règlement de chaque versement (Stripe ou virement).
-- Exécuter après 20260911_paiements_crm.sql, AVANT de publier le CRM v23.
-- Trois colonnes seulement, une par versement possible : l'acompte et le
-- solde d'un stage, le règlement total d'un cours ou d'un trimestre.
-- Aucun encaissement déjà noté n'est modifié : les versements rapprochés
-- depuis le registre Stripe sont repris comme « stripe », les autres
-- restent sans moyen connu tant que l'académie ne l'a pas précisé.
begin;

alter table public.demandes add column if not exists acompte_moyen text;
alter table public.demandes add column if not exists solde_moyen text;
alter table public.demandes add column if not exists paye_moyen text;

-- PostgreSQL n'a pas d'« add constraint if not exists » : on ne l'ajoute
-- qu'une fois, pour que la migration reste rejouable sans erreur.
do $moyens$
begin
  if not exists (select 1 from pg_constraint where conname = 'demandes_moyens_connus') then
    alter table public.demandes add constraint demandes_moyens_connus check (
      (acompte_moyen is null or acompte_moyen in ('stripe', 'virement')) and
      (solde_moyen is null or solde_moyen in ('stripe', 'virement')) and
      (paye_moyen is null or paye_moyen in ('stripe', 'virement')));
  end if;
end
$moyens$;

-- Reprise de l'historique : un versement déjà rapproché d'une session
-- Stripe vient forcément de Stripe. Le reste est laissé vide plutôt que
-- deviné : un virement et un règlement noté à la main se ressemblent.
update public.demandes d set
  acompte_moyen = coalesce(d.acompte_moyen, case when d.acompte_paye and exists (
      select 1 from public.crm_paiements_stripe p
      where p.demande_id = d.id and p.nature in ('total', 'acompte')) then 'stripe' end),
  solde_moyen = coalesce(d.solde_moyen, case when d.solde_paye and exists (
      select 1 from public.crm_paiements_stripe p
      where p.demande_id = d.id and p.nature in ('total', 'solde')) then 'stripe' end),
  paye_moyen = coalesce(d.paye_moyen, case when d.paye and exists (
      select 1 from public.crm_paiements_stripe p
      where p.demande_id = d.id and p.nature in ('total', 'solde')) then 'stripe' end)
where d.acompte_moyen is null or d.solde_moyen is null or d.paye_moyen is null;

-- Le rapprochement Stripe estampille désormais le moyen. Le corps est
-- celui de la v22, à ces trois colonnes près : toute autre règle
-- (verrous, montants, registre) reste identique.
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
    acompte_moyen = case when type = 'stage' and v_nature in ('total','acompte') then 'stripe' else acompte_moyen end,
    solde_paye = case when type = 'stage' and v_nature in ('total','solde') then true else solde_paye end,
    solde_le = case when type = 'stage' and v_nature in ('total','solde') then v_jour else solde_le end,
    solde_moyen = case when type = 'stage' and v_nature in ('total','solde') then 'stripe' else solde_moyen end,
    paye = case when v_nature in ('total','solde') then true else paye end,
    paye_le = case when v_nature in ('total','solde') then v_jour else paye_le end,
    paye_moyen = case when v_nature in ('total','solde') then 'stripe' else paye_moyen end,
    paye_montant = case when v_nature in ('total','solde') then (v_total::numeric / 100)::text || ' €' else paye_montant end
  where id = p_demande_id returning * into v_d;
  update public.crm_paiements_stripe set demande_id = p_demande_id, nature = v_nature,
    rapproche_le = now(), rapproche_par = v_acteur where session_id = p_session_id returning * into v_p;
  return jsonb_build_object('ok', true, 'deja_rapproche', false,
    'demande', to_jsonb(v_d), 'paiement', to_jsonb(v_p));
end;
$$;

revoke all on function public.crm_appliquer_paiement_stripe(uuid,text,text) from public, anon;
grant execute on function public.crm_appliquer_paiement_stripe(uuid,text,text) to authenticated, service_role;

commit;
