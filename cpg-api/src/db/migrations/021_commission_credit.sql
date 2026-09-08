-- ═══════════════════════════════════════════════════════════════════
--  021 — Commission crédit : 1 % prélevé à chaque déblocage
-- ═══════════════════════════════════════════════════════════════════
--
--  Jusqu'ici, le client recevait 100 % du montant approuvé sans
--  aucun frais réellement prélevé — le mécanisme de frais existait en
--  base mais n'était jamais déclenché à l'approbation finale.
--
--  Cette migration crée le frais lui-même, avec un taux initial de
--  1 %, actif immédiatement. Le taux reste ajustable ensuite depuis
--  Catalogue → Services & agios, sans nouveau déploiement.
DO $$
DECLARE
  v_directeur_id UUID;
  v_fee_id UUID;
BEGIN
  SELECT id INTO v_directeur_id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1;

  INSERT INTO fee_definitions (code, name, description, basis, trigger_on, status, created_by, activated_by, activated_at)
  VALUES (
    'COMM_CREDIT', 'Commission crédit',
    'Prélevée automatiquement sur le compte du client au moment du déblocage — le client reçoit 100 % du montant approuvé, puis cette commission est débitée.',
    'pourcentage', 'deblocage_credit', 'actif', v_directeur_id, v_directeur_id, now()
  )
  ON CONFLICT (code) DO NOTHING
  RETURNING id INTO v_fee_id;

  IF v_fee_id IS NOT NULL THEN
    INSERT INTO fee_versions (fee_id, version, amount, rate, min_amount, max_amount, exempt_below, created_by, approved_by, note)
    VALUES (v_fee_id, 1, 0, 0.010000, 0, NULL, 0, v_directeur_id, v_directeur_id, 'Taux initial : 1 %');
  END IF;
END $$;
