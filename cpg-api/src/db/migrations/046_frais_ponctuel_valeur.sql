-- ═══════════════════════════════════════════════════════════════════
--  FRAIS PRÉLEVÉ PONCTUELLEMENT — nouvelle valeur d'énumération
-- ═══════════════════════════════════════════════════════════════════
--
-- L'opératrice doit pouvoir prélever les frais de tenue de compte ou
-- les agios d'un client que le prélèvement automatique du 25 a manqué
-- — un agent crédité après cette date, ou créé entre deux passages.
-- La caisse l'a signalé plusieurs fois (BOUBANDA, MAPAGA, les agents
-- SOBAMA/QSR/STVB d'octobre).
--
-- Comme le retrait ponctuel, ce n'est qu'une DEMANDE : rien n'est
-- prélevé avant la validation du directeur.
--
-- Cette migration n'ajoute QUE la valeur d'énumération. PostgreSQL
-- refuse qu'une valeur ajoutée par ALTER TYPE soit utilisée dans la
-- même transaction, et le lanceur envoie chaque fichier d'un bloc :
-- les colonnes et la contrainte qui s'en servent sont dans la 047.

ALTER TYPE caisse_operation_type ADD VALUE IF NOT EXISTS 'frais_ponctuel';
