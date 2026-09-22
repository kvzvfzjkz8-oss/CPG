-- ═══════════════════════════════════════════════════════════════════
--  Import des crédits historiques (ancien logiciel)
-- ═══════════════════════════════════════════════════════════════════
--
--  Table de traçabilité pour l'import ponctuel des anciens crédits
--  (fichier Apple Numbers fourni par la direction). Chaque ligne du
--  fichier source importée est enregistrée ici, avec sa référence de
--  ligne d'origine en UNIQUE : si le script d'import est relancé (par
--  erreur, ou après une interruption), les lignes déjà traitées sont
--  automatiquement ignorées plutôt que dupliquées.

BEGIN;

CREATE TABLE legacy_credit_imports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ligne_origine  INT UNIQUE NOT NULL,         -- numéro de ligne dans le fichier source
  credit_id      UUID NOT NULL REFERENCES credit_requests(id),
  client_id      UUID NOT NULL REFERENCES users(id),
  nouveau_client BOOLEAN NOT NULL DEFAULT false, -- le compte a-t-il été créé pour cet import ?
  nom_fichier    TEXT NOT NULL,                -- nom tel qu'il apparaît dans l'ancien fichier
  montant        BIGINT NOT NULL,
  imported_by    UUID NOT NULL REFERENCES users(id),
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_legacy_imports_client ON legacy_credit_imports(client_id);

COMMIT;
