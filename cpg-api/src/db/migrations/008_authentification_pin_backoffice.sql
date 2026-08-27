-- ─────────────────────────────────────────────────────────────────────
--  AUTHENTIFICATION BACK-OFFICE PAR CODE PIN (8 CHIFFRES)
-- ─────────────────────────────────────────────────────────────────────
--
-- Réutilise la colonne pin_hash déjà présente sur users (jusqu'ici
-- réservée aux clients, code PIN 4 à 6 chiffres) : un compte n'est
-- jamais à la fois client et employé, la colonne sert donc les deux
-- usages sans ambiguïté, seule la validation du format diffère selon
-- le rôle (contrôlée côté API, pas en base, puisqu'on ne peut pas
-- vérifier un nombre de chiffres sur un hash bcrypt).
--
-- « Seul le Directeur pourra modifier, supprimer ou mettre à jour un
--   pin » : ces deux colonnes tracent qui l'a fait et quand, pour
-- qu'un coup d'œil sur la fiche employé suffise à voir qu'un PIN a
-- été touché, sans devoir croiser avec le journal d'audit.
ALTER TABLE users
  ADD COLUMN pin_updated_by UUID REFERENCES users(id),
  ADD COLUMN pin_updated_at TIMESTAMPTZ;
