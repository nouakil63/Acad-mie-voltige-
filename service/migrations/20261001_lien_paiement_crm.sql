-- CRM : le dossier garde la date et l'heure du dernier lien de paiement envoyé.
-- Exécuter AVANT de publier le CRM qui note cet envoi ; tant qu'elle n'est pas
-- passée, les mails partent normalement mais la date n'est pas enregistrée.
-- Rejouable : la colonne n'est ajoutée que si elle manque. Aucune donnée modifiée.
begin;

alter table public.demandes add column if not exists lien_paiement_envoye_le timestamptz;

commit;
