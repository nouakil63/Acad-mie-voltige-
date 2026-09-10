-- CRM : capacité par date + heure, contrôlée lors d'un nouveau placement.
-- Prérequis : supabase-admin.sql (colonnes cours_date, cours_heure, annule).
-- Aucun UPDATE des anciennes demandes : les anciens plannings restent lisibles.
begin;

create or replace function public.crm_normaliser_heure_cours(p_heure text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_morceaux text[]; v_heure integer; v_minute integer;
begin
  v_morceaux := regexp_match(btrim(coalesce(p_heure, '')), '^([0-9]{1,2})\s*[:hH]\s*([0-9]{0,2})$');
  if v_morceaux is null then return null; end if;
  v_heure := v_morceaux[1]::integer;
  v_minute := coalesce(nullif(v_morceaux[2], ''), '0')::integer;
  if v_heure > 23 or v_minute > 59 then return null; end if;
  return lpad(v_heure::text, 2, '0') || ':' || lpad(v_minute::text, 2, '0');
end $$;

-- Une ligne sert de verrou pour chaque créneau utilisé après installation.
-- L'UPSERT prend un verrou de ligne jusqu'au COMMIT. Sous REPEATABLE READ,
-- une écriture concurrente provoque un échec de sérialisation plutôt qu'un
-- comptage réalisé sur un ancien instantané. Ces lignes ne sont pas des cours.
create table if not exists public.crm_verrous_creneaux (
  date date not null,
  heure text not null,
  revision bigint not null default 1,
  primary key (date, heure)
);
alter table public.crm_verrous_creneaux enable row level security;
revoke all on public.crm_verrous_creneaux from public, anon, authenticated, service_role;

create or replace function public.crm_verifier_placement_cours()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_heure text; v_ancienne_heure text; v_nombre integer;
begin
  -- Annuler, refuser, déplanifier ou modifier un stage ne consomme aucune place.
  if coalesce(new.type, 'cours') = 'stage' or new.statut is distinct from 'validée'
    or coalesce(new.annule, false) or new.cours_date is null then
    return new;
  end if;
  v_heure := public.crm_normaliser_heure_cours(new.cours_heure);

  if tg_op = 'UPDATE' then
    v_ancienne_heure := public.crm_normaliser_heure_cours(old.cours_heure);
    -- Un ancien placement identique n'est pas réexaminé. Cela autorise les
    -- corrections de contact, paiement, date d'encaissement et renvois d'e-mail,
    -- même pour une ancienne ligne sans heure ou avec une capacité dépassée.
    if coalesce(old.type, 'cours') <> 'stage' and old.statut = 'validée'
      and not coalesce(old.annule, false) and old.cours_date = new.cours_date
      and (old.cours_heure is not distinct from new.cours_heure
        or (v_heure is not null and v_heure = v_ancienne_heure)) then
      if v_heure is not null then new.cours_heure := v_heure; end if;
      return new;
    end if;
  end if;

  if not isfinite(new.cours_date) then
    raise exception using message = 'cours_date_invalide', errcode = '23514';
  end if;
  if new.cours_date < (current_timestamp at time zone 'Europe/Paris')::date then
    raise exception using message = 'cours_date_passee', errcode = '23514';
  end if;
  if extract(isodow from new.cours_date) <> 6 then
    raise exception using message = 'cours_samedi_uniquement', errcode = '23514';
  end if;
  if v_heure is null then
    raise exception using message = 'cours_heure_invalide', errcode = '23514';
  end if;

  insert into public.crm_verrous_creneaux(date, heure) values (new.cours_date, v_heure)
    on conflict (date, heure) do update
      set revision = public.crm_verrous_creneaux.revision + 1;

  select count(*) into v_nombre from public.demandes d
    where d.id is distinct from new.id and coalesce(d.type, 'cours') <> 'stage'
      and d.statut = 'validée' and not coalesce(d.annule, false)
      and d.cours_date = new.cours_date
      and public.crm_normaliser_heure_cours(d.cours_heure) = v_heure;
  if v_nombre >= 8 then
    raise exception using message = 'cours_complet', errcode = '23514';
  end if;
  new.cours_heure := v_heure;
  return new;
end $$;

revoke all on function public.crm_verifier_placement_cours() from public, anon, authenticated, service_role;
drop trigger if exists crm_verifier_placement_cours on public.demandes;
create trigger crm_verifier_placement_cours
  before insert or update of type, statut, annule, cours_date, cours_heure
  on public.demandes for each row execute function public.crm_verifier_placement_cours();

commit;
