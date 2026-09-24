-- CRM : « vu avec Georges » devient un moyen de règlement à part entière.
-- Exécuter après 20260917_moyens_paiement_crm.sql, AVANT de publier le CRM
-- qui propose ce moyen. Rejouable : la contrainte est simplement recréée.
-- Aucun encaissement existant n'est modifié.
begin;

alter table public.demandes drop constraint if exists demandes_moyens_connus;
alter table public.demandes add constraint demandes_moyens_connus check (
  (acompte_moyen is null or acompte_moyen in ('stripe', 'virement', 'georges')) and
  (solde_moyen is null or solde_moyen in ('stripe', 'virement', 'georges')) and
  (paye_moyen is null or paye_moyen in ('stripe', 'virement', 'georges')));

commit;
