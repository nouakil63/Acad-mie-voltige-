-- CRM v24 : remboursements Stripe, sans réécrire les règlements/annulations historiques.
-- Prérequis : 20260911_paiements_crm.sql. Exécuter avant Code.gs v24.
-- Les snapshots proviennent exclusivement du service : Stripe live, EUR, charge
-- capturée, liste des remboursements COMPLÈTE, horodatage pris AVANT les lectures.
-- Aucune réservation incertaine n'expire. Après 23 h, retrouver le remboursement
-- via metadata.crm_operation_id ; ne jamais créer une nouvelle clé par défaut.
begin;

create table if not exists public.crm_etats_stripe (
  session_id text primary key references public.crm_paiements_stripe(session_id) on delete restrict,
  demande_id uuid references public.demandes(id) on delete restrict,
  payment_intent_id text not null unique check (payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  charge_id text not null unique check (charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  montant_centimes bigint not null check (montant_centimes > 0),
  rembourse_centimes bigint not null check (rembourse_centimes >= 0),
  en_attente_centimes bigint not null check (en_attente_centimes >= 0),
  conteste boolean not null,
  verifie_le timestamptz not null,
  snapshot jsonb,
  check (rembourse_centimes + en_attente_centimes <= montant_centimes)
);

create table if not exists public.crm_operations_remboursement_stripe (
  operation_id uuid primary key,
  demande_id uuid not null references public.demandes(id) on delete restrict,
  session_id text not null references public.crm_etats_stripe(session_id) on delete restrict,
  montant_centimes bigint not null check (montant_centimes > 0),
  motif text not null check (motif in ('requested_by_customer', 'duplicate', 'fraudulent')),
  statut text not null check (statut in ('reserve','incertain','pending','requires_action','succeeded','failed','canceled')),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  acteur text,
  stripe_refund_id text unique,
  check ((statut in ('reserve','incertain') and stripe_refund_id is null)
    or (statut in ('pending','requires_action','succeeded','failed','canceled') and stripe_refund_id is not null))
);
create index if not exists crm_operations_remboursement_session_idx
  on public.crm_operations_remboursement_stripe(session_id);

create table if not exists public.crm_remboursements_stripe (
  refund_id text primary key check (refund_id ~ '^re_[A-Za-z0-9_]+$'),
  session_id text not null references public.crm_etats_stripe(session_id) on delete restrict,
  montant_centimes bigint not null check (montant_centimes > 0),
  statut text not null check (statut in ('pending','requires_action','succeeded','failed','canceled')),
  cree_le timestamptz not null,
  motif text,
  operation_id uuid unique references public.crm_operations_remboursement_stripe(operation_id) on delete restrict,
  verifie_le timestamptz not null
);
create index if not exists crm_remboursements_session_idx on public.crm_remboursements_stripe(session_id);

alter table public.crm_etats_stripe enable row level security;
alter table public.crm_operations_remboursement_stripe enable row level security;
alter table public.crm_remboursements_stripe enable row level security;
revoke all on public.crm_etats_stripe, public.crm_operations_remboursement_stripe,
  public.crm_remboursements_stripe from public, anon, authenticated, service_role;
grant select on public.crm_etats_stripe, public.crm_operations_remboursement_stripe,
  public.crm_remboursements_stripe to authenticated, service_role;
drop policy if exists "admins lisent etats Stripe" on public.crm_etats_stripe;
create policy "admins lisent etats Stripe" on public.crm_etats_stripe for select to authenticated
  using (exists(select 1 from public.admins where lower(email)=lower(auth.jwt()->>'email')));
drop policy if exists "admins lisent operations Stripe" on public.crm_operations_remboursement_stripe;
create policy "admins lisent operations Stripe" on public.crm_operations_remboursement_stripe for select to authenticated
  using (exists(select 1 from public.admins where lower(email)=lower(auth.jwt()->>'email')));
drop policy if exists "admins lisent remboursements Stripe" on public.crm_remboursements_stripe;
create policy "admins lisent remboursements Stripe" on public.crm_remboursements_stripe for select to authenticated
  using (exists(select 1 from public.admins where lower(email)=lower(auth.jwt()->>'email')));

-- Helpers privés : les RPC publiques ci-dessous sont les seules écritures.
create or replace function public.crm_resume_remboursements_stripe(p_session_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok',true,'etat',to_jsonb(e)-'snapshot',
    'remboursements',coalesce((select jsonb_agg(to_jsonb(r) order by r.cree_le,r.refund_id)
      from public.crm_remboursements_stripe r where r.session_id=e.session_id),'[]'::jsonb),
    'operations',coalesce((select jsonb_agg(to_jsonb(o) order by o.cree_le,o.operation_id)
      from public.crm_operations_remboursement_stripe o where o.session_id=e.session_id),'[]'::jsonb),
    'reserve_centimes',h.total,
    'disponible_centimes',case when e.conteste then 0 else greatest(0,
      e.montant_centimes-e.rembourse_centimes-e.en_attente_centimes-h.total) end)
  from public.crm_etats_stripe e cross join lateral (
    select coalesce(sum(o.montant_centimes),0)::bigint total
    from public.crm_operations_remboursement_stripe o
    where o.session_id=e.session_id and o.statut in ('reserve','incertain')
  ) h where e.session_id=p_session_id
$$;
revoke all on function public.crm_resume_remboursements_stripe(text) from public,anon,authenticated,service_role;

create or replace function public.crm_enregistrer_snapshot_stripe(p_session_id text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.crm_paiements_stripe%rowtype;
  v_e public.crm_etats_stripe%rowtype;
  v_old public.crm_remboursements_stripe%rowtype;
  v_op public.crm_operations_remboursement_stripe%rowtype;
  v_r jsonb; v_id text; v_status text; v_amount bigint; v_time timestamptz;
  v_created timestamptz; v_operation uuid; v_success bigint := 0; v_pending bigint := 0;
  v_seen text[] := array[]::text[]; v_gross bigint;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception using message='acces_refuse',errcode='42501'; end if;
  -- Même verrou pour snapshot, réservation, terminaison et rapprochement v22.
  select * into v_p from public.crm_paiements_stripe where session_id=p_session_id for update;
  if not found then raise exception 'paiement_introuvable'; end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot->>'devise' is distinct from 'eur' or p_snapshot->'livemode' is distinct from 'true'::jsonb
    or coalesce(p_snapshot->>'payment_intent_id','') !~ '^pi_[A-Za-z0-9_]+$'
    or coalesce(p_snapshot->>'charge_id','') !~ '^ch_[A-Za-z0-9_]+$'
    or coalesce(p_snapshot->>'montant_centimes','') !~ '^[0-9]+$'
    or coalesce(p_snapshot->>'rembourse_centimes','') !~ '^[0-9]+$'
    or coalesce(p_snapshot->>'en_attente_centimes','') !~ '^[0-9]+$'
    or jsonb_typeof(p_snapshot->'conteste') is distinct from 'boolean'
    or jsonb_typeof(p_snapshot->'remboursements') is distinct from 'array'
    or coalesce(p_snapshot->>'verifie_le','')='' then raise exception 'snapshot_invalide'; end if;
  v_gross := (p_snapshot->>'montant_centimes')::bigint;
  v_time := (p_snapshot->>'verifie_le')::timestamptz;
  if not isfinite(v_time) or v_time > clock_timestamp()+interval '1 minute'
    or v_gross <> v_p.montant_centimes or v_p.devise <> 'eur' then raise exception 'snapshot_incoherent'; end if;
  select * into v_e from public.crm_etats_stripe where session_id=p_session_id;
  if found then
    if v_e.payment_intent_id <> p_snapshot->>'payment_intent_id' or v_e.charge_id <> p_snapshot->>'charge_id'
      or v_e.montant_centimes <> v_gross then raise exception 'identite_paiement_modifiee'; end if;
    if v_time < v_e.verifie_le then raise exception 'snapshot_perime'; end if;
    if v_time = v_e.verifie_le then
      if v_e.snapshot=p_snapshot then return public.crm_resume_remboursements_stripe(p_session_id); end if;
      raise exception 'snapshot_ordre_ambigu';
    end if;
  end if;
  -- L'unicité PI ET Charge empêche deux Checkout Sessions de partager le plafond.
  insert into public.crm_etats_stripe(session_id,demande_id,payment_intent_id,charge_id,
    montant_centimes,rembourse_centimes,en_attente_centimes,conteste,verifie_le,snapshot)
    values(p_session_id,v_p.demande_id,p_snapshot->>'payment_intent_id',p_snapshot->>'charge_id',
      v_gross,0,0,(p_snapshot->>'conteste')::boolean,v_time,p_snapshot)
    on conflict(session_id) do update set demande_id=excluded.demande_id,
      conteste=excluded.conteste,verifie_le=excluded.verifie_le,snapshot=excluded.snapshot;
  for v_r in select value from jsonb_array_elements(p_snapshot->'remboursements') loop
    v_id := v_r->>'id'; v_status := v_r->>'statut';
    if jsonb_typeof(v_r) is distinct from 'object' or coalesce(v_id,'') !~ '^re_[A-Za-z0-9_]+$'
      or coalesce(v_status,'') not in ('pending','requires_action','succeeded','failed','canceled')
      or coalesce(v_r->>'montant_centimes','') !~ '^[0-9]+$'
      or coalesce(v_r->>'cree_le','')='' or v_id=any(v_seen) then raise exception 'remboursement_invalide'; end if;
    v_seen := array_append(v_seen,v_id);
    v_amount := (v_r->>'montant_centimes')::bigint;
    v_created := (v_r->>'cree_le')::timestamptz;
    if v_amount <= 0 or v_amount > v_gross or not isfinite(v_created)
      or v_created > v_time+interval '1 minute' or v_created<date_trunc('second',v_p.recu_le)
      or (v_r ? 'payment_intent_id' and v_r->>'payment_intent_id' is distinct from p_snapshot->>'payment_intent_id')
      or (v_r ? 'charge_id' and v_r->>'charge_id' is distinct from p_snapshot->>'charge_id')
      then raise exception 'remboursement_incoherent'; end if;
    v_operation := nullif(v_r->>'operation_id','')::uuid;
    select * into v_old from public.crm_remboursements_stripe where refund_id=v_id;
    if found then
      if v_old.session_id<>p_session_id or v_old.montant_centimes<>v_amount or v_old.cree_le<>v_created
        or (v_old.operation_id is not null and v_operation is distinct from v_old.operation_id)
        then raise exception 'remboursement_identite_modifiee'; end if;
      -- Un résultat terminal ne doit pas redevenir une attente. Les échecs/cancel
      -- sont définitifs ; un succès peut exceptionnellement échouer côté Stripe.
      if (v_old.statut in ('failed','canceled') and v_status<>v_old.statut)
        or (v_old.statut='succeeded' and v_status in ('pending','requires_action','canceled'))
        then raise exception 'remboursement_transition_invalide'; end if;
    end if;
    if v_operation is not null then
      select * into v_op from public.crm_operations_remboursement_stripe where operation_id=v_operation for update;
      if not found then raise exception 'operation_metadata_inconnue'; end if;
      if v_op.session_id<>p_session_id or v_op.demande_id is distinct from v_p.demande_id
        or v_op.montant_centimes<>v_amount or v_op.motif is distinct from v_r->>'motif'
        or v_created<date_trunc('second',v_op.cree_le)
        or (v_op.stripe_refund_id is not null and v_op.stripe_refund_id<>v_id)
        then raise exception 'operation_metadata_incoherente'; end if;
      update public.crm_operations_remboursement_stripe set statut=v_status,stripe_refund_id=v_id,maj_le=v_time
        where operation_id=v_operation;
    end if;
    insert into public.crm_remboursements_stripe(refund_id,session_id,montant_centimes,statut,cree_le,motif,operation_id,verifie_le)
      values(v_id,p_session_id,v_amount,v_status,v_created,v_r->>'motif',v_operation,v_time)
      on conflict(refund_id) do update set statut=excluded.statut,motif=excluded.motif,
        operation_id=excluded.operation_id,verifie_le=excluded.verifie_le;
    if v_status='succeeded' then v_success:=v_success+v_amount;
    elsif v_status in ('pending','requires_action') then v_pending:=v_pending+v_amount; end if;
  end loop;
  if exists(select 1 from public.crm_remboursements_stripe where session_id=p_session_id and not(refund_id=any(v_seen)))
    then raise exception 'snapshot_remboursements_incomplet'; end if;
  if v_success<>(p_snapshot->>'rembourse_centimes')::bigint
    or v_pending<>(p_snapshot->>'en_attente_centimes')::bigint or v_success+v_pending>v_gross
    then raise exception 'snapshot_totaux_incoherents'; end if;
  update public.crm_etats_stripe set rembourse_centimes=v_success,en_attente_centimes=v_pending where session_id=p_session_id;
  return public.crm_resume_remboursements_stripe(p_session_id);
end;
$$;

create or replace function public.crm_reserver_remboursement_stripe(
  p_operation_id uuid,p_demande_id uuid,p_session_id text,p_montant_centimes bigint,p_motif text,p_acteur text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.crm_paiements_stripe%rowtype; v_e public.crm_etats_stripe%rowtype;
  v_o public.crm_operations_remboursement_stripe%rowtype; v_resume jsonb; v_retry boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using message='acces_refuse',errcode='42501'; end if;
  if p_operation_id is null or p_demande_id is null or p_montant_centimes is null or p_montant_centimes<=0
    or p_motif is null or p_motif not in ('requested_by_customer','duplicate','fraudulent') then raise exception 'operation_invalide'; end if;
  select * into v_p from public.crm_paiements_stripe where session_id=p_session_id for update;
  if not found then raise exception 'paiement_introuvable'; end if;
  if v_p.demande_id is distinct from p_demande_id then raise exception 'paiement_non_affecte_demande'; end if;
  select * into v_e from public.crm_etats_stripe where session_id=p_session_id;
  if not found then raise exception 'snapshot_requis'; end if;
  select * into v_o from public.crm_operations_remboursement_stripe where operation_id=p_operation_id for update;
  if found then
    if v_o.demande_id<>p_demande_id or v_o.session_id<>p_session_id or v_o.montant_centimes<>p_montant_centimes
      or v_o.motif<>p_motif then raise exception 'operation_id_reutilise'; end if;
    v_retry := v_o.statut in ('reserve','incertain') and v_o.cree_le>clock_timestamp()-interval '23 hours';
    -- Une reprise exige aussi Stripe à jour : un litige ou un remboursement
    -- externe découvert entre-temps interdit un nouvel envoi, même idempotent.
    if v_retry and (v_e.verifie_le<clock_timestamp()-interval '5 minutes' or v_e.conteste or v_e.en_attente_centimes>0
      or v_e.rembourse_centimes+v_e.en_attente_centimes+v_o.montant_centimes>v_e.montant_centimes) then v_retry:=false; end if;
    return public.crm_resume_remboursements_stripe(p_session_id)||jsonb_build_object('operation',to_jsonb(v_o),
      'execution_autorisee',v_retry,'reprise',true,'verification_manuelle',v_o.statut in ('reserve','incertain') and not v_retry);
  end if;
  if v_e.verifie_le<clock_timestamp()-interval '5 minutes' then raise exception 'snapshot_perime'; end if;
  if v_e.conteste then raise exception 'paiement_conteste'; end if;
  if v_e.en_attente_centimes>0 then raise exception 'remboursement_en_attente'; end if;
  if exists(select 1 from public.crm_operations_remboursement_stripe where session_id=p_session_id and statut in ('reserve','incertain'))
    then raise exception 'operation_incertitude_a_resoudre'; end if;
  v_resume := public.crm_resume_remboursements_stripe(p_session_id);
  if p_montant_centimes>(v_resume->>'disponible_centimes')::bigint then raise exception 'montant_superieur_disponible'; end if;
  insert into public.crm_operations_remboursement_stripe(operation_id,demande_id,session_id,montant_centimes,motif,statut,acteur)
    values(p_operation_id,p_demande_id,p_session_id,p_montant_centimes,p_motif,'reserve',p_acteur) returning * into v_o;
  return public.crm_resume_remboursements_stripe(p_session_id)||jsonb_build_object('operation',to_jsonb(v_o),
    'execution_autorisee',true,'reprise',false,'verification_manuelle',false);
end;
$$;

create or replace function public.crm_terminer_remboursement_stripe(p_operation_id uuid,p_refund jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_o public.crm_operations_remboursement_stripe%rowtype; v_e public.crm_etats_stripe%rowtype;
  v_refunds jsonb; v_snapshot jsonb; v_result jsonb; v_time timestamptz; v_success bigint; v_pending bigint;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using message='acces_refuse',errcode='42501'; end if;
  select * into v_o from public.crm_operations_remboursement_stripe where operation_id=p_operation_id;
  if not found then raise exception 'operation_introuvable'; end if;
  perform 1 from public.crm_paiements_stripe where session_id=v_o.session_id for update;
  select * into v_o from public.crm_operations_remboursement_stripe where operation_id=p_operation_id for update;
  select * into v_e from public.crm_etats_stripe where session_id=v_o.session_id;
  if p_refund->>'statut'='incertain' and coalesce(p_refund->>'id','')='' then
    if v_o.statut in ('reserve','incertain') then
      update public.crm_operations_remboursement_stripe set statut='incertain',maj_le=clock_timestamp()
        where operation_id=p_operation_id returning * into v_o;
    end if;
    return public.crm_resume_remboursements_stripe(v_o.session_id)||jsonb_build_object('operation',to_jsonb(v_o));
  end if;
  if jsonb_typeof(p_refund) is distinct from 'object'
    or p_refund->>'payment_intent_id' is distinct from v_e.payment_intent_id
    or p_refund->>'charge_id' is distinct from v_e.charge_id
    or coalesce(p_refund->>'verifie_le','')=''
    or (nullif(p_refund->>'operation_id','') is not null and (p_refund->>'operation_id')::uuid<>p_operation_id)
    then raise exception 'retour_stripe_invalide'; end if;
  v_time := (p_refund->>'verifie_le')::timestamptz;
  -- Une réponse ancienne ne peut pas écraser une synchronisation plus récente.
  if v_time<=v_e.verifie_le then
    if exists(select 1 from public.crm_remboursements_stripe r where r.refund_id=p_refund->>'id'
      and r.operation_id=p_operation_id and r.statut=p_refund->>'statut'
      and r.montant_centimes::text=p_refund->>'montant_centimes') then
      return public.crm_resume_remboursements_stripe(v_o.session_id)||jsonb_build_object('operation',to_jsonb(v_o));
    end if;
    raise exception 'snapshot_perime';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',refund_id,'montant_centimes',montant_centimes,
    'statut',statut,'cree_le',cree_le,'motif',motif,'operation_id',operation_id)),'[]'::jsonb)
    into v_refunds from public.crm_remboursements_stripe where session_id=v_o.session_id and refund_id<>coalesce(p_refund->>'id','');
  v_refunds:=v_refunds||jsonb_build_array((p_refund-'payment_intent_id'-'charge_id'-'verifie_le')||jsonb_build_object('operation_id',p_operation_id));
  select coalesce(sum((r->>'montant_centimes')::bigint) filter(where r->>'statut'='succeeded'),0),
    coalesce(sum((r->>'montant_centimes')::bigint) filter(where r->>'statut' in ('pending','requires_action')),0)
    into v_success,v_pending from jsonb_array_elements(v_refunds) r;
  v_snapshot:=jsonb_build_object('payment_intent_id',v_e.payment_intent_id,'charge_id',v_e.charge_id,
    'devise','eur','livemode',true,
    'montant_centimes',v_e.montant_centimes,'rembourse_centimes',v_success,'en_attente_centimes',v_pending,
    'conteste',v_e.conteste,'verifie_le',v_time,'remboursements',v_refunds);
  v_result:=public.crm_enregistrer_snapshot_stripe(v_o.session_id,v_snapshot);
  select * into v_o from public.crm_operations_remboursement_stripe where operation_id=p_operation_id;
  return v_result||jsonb_build_object('operation',to_jsonb(v_o));
end;
$$;

-- Ferme également le contournement de la vérification Stripe via RPC v22 directe.
-- Seulement les NOUVELLES affectations : aucune reprise des données à l'installation.
create or replace function public.crm_verifier_affectation_stripe()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_e public.crm_etats_stripe%rowtype;
begin
  if old.demande_id is null and new.demande_id is not null then
    select * into v_e from public.crm_etats_stripe where session_id=new.session_id;
    if not found or v_e.verifie_le<clock_timestamp()-interval '5 minutes' then raise exception 'snapshot_requis_rapprochement'; end if;
    if v_e.conteste or v_e.rembourse_centimes>0 or v_e.en_attente_centimes>0 then raise exception 'paiement_rembourse_ou_conteste'; end if;
    update public.crm_etats_stripe set demande_id=new.demande_id where session_id=new.session_id;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_verifier_affectation_stripe on public.crm_paiements_stripe;
create trigger crm_verifier_affectation_stripe before update of demande_id on public.crm_paiements_stripe
  for each row execute function public.crm_verifier_affectation_stripe();

revoke all on function public.crm_enregistrer_snapshot_stripe(text,jsonb),
  public.crm_reserver_remboursement_stripe(uuid,uuid,text,bigint,text,text),
  public.crm_terminer_remboursement_stripe(uuid,jsonb),public.crm_verifier_affectation_stripe()
  from public,anon,authenticated,service_role;
grant execute on function public.crm_enregistrer_snapshot_stripe(text,jsonb),
  public.crm_reserver_remboursement_stripe(uuid,uuid,text,bigint,text,text),
  public.crm_terminer_remboursement_stripe(uuid,jsonb) to service_role;
commit;
