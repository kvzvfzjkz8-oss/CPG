-- ═══════════════════════════════════════════════════════════════════
--  031 — Suppression d'un crédit actif créé en excès, par le directeur
-- ═══════════════════════════════════════════════════════════════════
--
--  Réservé au directeur : un crédit approuvé peut avoir été créé en
--  double ou par erreur. On ne le supprime jamais du journal — on
--  porte une extourne (même mécanisme que l'annulation de
--  transaction déjà en place), et on marque le dossier 'annule' pour
--  qu'il sorte des crédits actifs. Refusé net si la moindre échéance
--  a déjà été payée : dans ce cas, la situation doit être régularisée
--  à la main, pas défaite automatiquement.

ALTER TYPE credit_status ADD VALUE IF NOT EXISTS 'annule';
