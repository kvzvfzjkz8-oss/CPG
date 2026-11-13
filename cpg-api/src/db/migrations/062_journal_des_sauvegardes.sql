-- ═══════════════════════════════════════════════════════════════════
--  062 — JOURNAL DES SAUVEGARDES
-- ═══════════════════════════════════════════════════════════════════
--
-- Les sauvegardes vivent sur une machine, le logiciel sur une autre :
-- personne, dans le logiciel, ne sait si la base a été sauvegardée
-- hier ou il y a trois semaines.
--
-- Les 11 et 12 novembre 2026, l'agent a échoué deux soirs de suite sur
-- une erreur DNS — le Mac dormait à 20h30. Trois jours sans sauvegarde,
-- dont celui de la paie EFF : 20 076 514 F versés et 884 074 F
-- prélevés. Personne ne l'a vu, parce que le seul endroit où cela
-- s'écrivait était un fichier journal que personne n'ouvre.
--
-- Cette table est donc le point de rencontre : `sauvegarder_base.mjs` y
-- inscrit une ligne à chaque sauvegarde réussie, et les notifications
-- du directeur s'en servent pour alerter au-delà de 48 heures.
--
-- Elle ne contient AUCUNE donnée client — seulement la preuve qu'une
-- sauvegarde a eu lieu, et de quoi la retrouver : son nom de fichier,
-- son empreinte, et ce qu'elle contenait au moment du dump. L'empreinte
-- permet de vérifier qu'un fichier retrouvé est bien celui qui a été
-- pris ce jour-là.

CREATE TABLE sauvegardes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prise_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fichier          TEXT NOT NULL,
  sha256           TEXT NOT NULL,
  taille_chiffree  BIGINT NOT NULL,
  taille_dump      BIGINT NOT NULL,
  tables           INTEGER NOT NULL,
  lignes_total     INTEGER NOT NULL,
  miroir           BOOLEAN NOT NULL DEFAULT false,
  hote             TEXT,

  -- Une même sauvegarde ne s'inscrit qu'une fois, même si le script est
  -- relancé sur le même fichier.
  CONSTRAINT sauvegardes_fichier_unique UNIQUE (fichier)
);

CREATE INDEX idx_sauvegardes_prise_le ON sauvegardes(prise_le DESC);
