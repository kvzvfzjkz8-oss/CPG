/**
 * ─────────────────────────────────────────────────────────────────────
 *  GESTION DES CRÉDITS — trois signatures avant qu'un dossier bouge
 * ─────────────────────────────────────────────────────────────────────
 *
 * « Il faut créer un onglet pour le gestionnaire et le directeur qui
 *   s'appelle "gestion des crédits". Dans cet onglet le gestionnaire
 *   aura la possibilité de modifier un crédit : changer les dates de
 *   prélèvements avec accord préalable de l'opérateur puis validation
 *   du directeur, demander un prélèvement supplémentaire, supprimer un
 *   crédit, ou encore modifier le montant du crédit car le client a
 *   anticipé sur la prochaine échéance en déposant un montant. À
 *   ajouter aussi la modification des taux pour certains crédits en
 *   cours, ou sauter un mois de prélèvement pour certains clients étant
 *   en difficulté. » (direction, 09/11/2026)
 *
 * Un seul écran pour les cinq natures, parce qu'elles suivent toutes le
 * même chemin : le gestionnaire propose, l'opérateur donne son accord,
 * le directeur valide. Rien ne s'applique avant la troisième signature,
 * et c'est ce que l'écran doit rendre évident — d'où la chronologie
 * affichée sur chaque demande plutôt qu'un simple badge d'état.
 *
 * Ce que chaque poste voit :
 *   • le gestionnaire : le formulaire de dépôt, et le suivi de ce qu'il
 *     a déposé — y compris les refus, avec leur motif ;
 *   • l'opérateur : les demandes qui attendent son accord ;
 *   • le directeur : celles qui attendent sa validation.
 * Les boutons n'apparaissent que si le poste peut vraiment agir : un
 * bouton qui renvoie 403 est un piège, pas une information.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CalendarClock, HandCoins, PauseCircle, Percent, PiggyBank, Search,
  RefreshCw, Check, X, AlertTriangle, ArrowRight, Clock,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from '../components/UI';
import { can } from '../auth/roles';
import {
  fetchModificationsCredit, proposerModificationCredit, accorderModificationCredit,
  validerModificationCredit, refuserModificationCredit, fetchCreditRequests,
  fetchEcheancierCredit,
} from '../api/adminApi';

const champ = {
  width: '100%', padding: '9px 11px', borderRadius: 8,
  border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body,
  background: colors.surface, color: colors.text, boxSizing: 'border-box',
};
const etiquette = {
  display: 'block', fontSize: 11, color: colors.muted,
  fontFamily: fonts.body, marginBottom: 5,
};

/**
 * Les cinq natures. `aide` dit au gestionnaire quand s'en servir —
 * c'est lui qui connaît le client, pas le logiciel.
 */
const NATURES = [
  {
    k: 'dates_echeances', t: 'Changer le jour de prélèvement', i: CalendarClock,
    d: 'Toutes les échéances à venir passent au même jour du mois. Le mois ne change pas.',
    champs: ['jour'],
  },
  {
    k: 'report_echeance', t: 'Sauter un mois', i: PauseCircle,
    d: 'Pour un client en difficulté : les échéances reculent, la mensualité reste identique. Coût : 10 000 F par mois sauté, ajoutés à la dernière échéance.',
    champs: ['mois'],
  },
  {
    k: 'prelevement_supplementaire', t: 'Prélèvement supplémentaire', i: HandCoins,
    d: 'Encaisser une mensualité de plus, hors du rythme normal d’un prélèvement par salaire.',
    champs: ['echeance'],
  },
  {
    k: 'montant', t: 'Dépôt anticipé du client', i: PiggyBank,
    d: 'Le client a déposé de l’argent d’avance : il est encaissé et imputé sur les prochaines échéances. Le capital baisse, les intérêts restent dus.',
    champs: ['montant'],
  },
  {
    k: 'taux', t: 'Réviser le taux', i: Percent,
    d: 'Le nouveau taux ne porte que sur les échéances restantes. Le plafond réglementaire est vérifié.',
    champs: ['taux'],
  },
];

const ETATS = {
  en_attente_operateur: { libelle: 'Attend l’opérateur', tone: 'gold' },
  en_attente_directeur: { libelle: 'Attend le directeur', tone: 'gold' },
  approuve: { libelle: 'Appliquée', tone: 'green' },
  rejete: { libelle: 'Refusée', tone: 'red' },
};

const nomNature = (k) => NATURES.find((n) => n.k === k)?.t ?? k;

/** Ce que la demande a réellement produit, en français. */
function resumerEffet(kind, effet) {
  if (!effet) return null;
  if (kind === 'dates_echeances') {
    return `${effet.echeances_redatees} échéance(s) ramenée(s) au ${effet.jour} du mois`;
  }
  if (kind === 'report_echeance') {
    return `${effet.echeances_reportees} échéance(s) reportée(s) de ${effet.mois} mois ; `
      + `${formatFCFA(effet.interets_ajoutes)} F d’intérêt de report ajoutés à l’échéance ${effet.derniere_echeance?.sequence}`;
  }
  if (kind === 'prelevement_supplementaire') {
    return `${formatFCFA(effet.preleve)} F prélevés sur l’échéance ${effet.sequence}`
      + (effet.decouvert ? ' — compte passé à découvert' : '');
  }
  if (kind === 'montant') {
    const soldees = effet.echeances_soldees?.length ?? 0;
    const bouts = [`${formatFCFA(effet.montant_impute)} F imputés`];
    if (soldees) bouts.push(`${soldees} échéance(s) soldée(s)`);
    if (effet.echeance_allegee) {
      bouts.push(`échéance ${effet.echeance_allegee.sequence} ramenée à ${formatFCFA(effet.echeance_allegee.apres)} F`);
    }
    if (effet.credit_solde) bouts.push('crédit soldé');
    return bouts.join(', ');
  }
  if (kind === 'taux') {
    return `${(effet.ancien_taux * 100).toFixed(2)} % → ${(effet.nouveau_taux * 100).toFixed(2)} %/mois, `
      + `mensualité ${formatFCFA(effet.ancienne_mensualite)} → ${formatFCFA(effet.nouvelle_mensualite)} F`;
  }
  return null;
}

/** La chronologie d'une demande : qui a signé, quand, et ce qu'il a dit. */
function Chronologie({ d }) {
  const etapes = [
    { f: 'Proposée', par: d.demande_par, le: d.demande_le, note: d.motif, fait: true },
    { f: 'Accord opérateur', par: d.accord_par, le: d.accord_le, note: d.accord_note, fait: Boolean(d.accord_le) },
    {
      f: d.status === 'rejete' ? 'Refusée' : 'Validation directeur',
      par: d.decide_par, le: d.decide_le, note: d.decision_note, fait: Boolean(d.decide_le),
    },
  ];
  return (
    <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
      {etapes.map((e) => (
        <div key={e.f} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', opacity: e.fait ? 1 : 0.45 }}>
          <div style={{ marginTop: 2 }}>
            {e.fait
              ? <Check size={13} color={d.status === 'rejete' && e.f === 'Refusée' ? colors.danger : colors.success} />
              : <Clock size={13} color={colors.muted} />}
          </div>
          <div style={{ fontSize: 12, fontFamily: fonts.body, lineHeight: 1.45 }}>
            <strong style={{ color: colors.text }}>{e.f}</strong>
            {e.par && <span style={{ color: colors.muted }}> — {e.par}</span>}
            {e.le && <span style={{ color: colors.muted }}>, le {e.le}</span>}
            {e.note && <div style={{ color: colors.muted, fontStyle: 'italic' }}>« {e.note} »</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CreditManagementView({ role }) {
  const peutProposer = can(role, 'credits.proposer_modification');
  const peutAccorder = can(role, 'credits.accorder_modification');
  const peutDecider = can(role, 'credits.decider_modification');

  const [demandes, setDemandes] = useState([]);
  const [credits, setCredits] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [busy, setBusy] = useState(null);

  // Le formulaire de dépôt
  const [nature, setNature] = useState(NATURES[0].k);
  const [recherche, setRecherche] = useState('');
  const [credit, setCredit] = useState(null);
  const [jour, setJour] = useState('4');
  const [mois, setMois] = useState('1');
  const [montant, setMontant] = useState('');
  const [taux, setTaux] = useState('');
  const [echeanceId, setEcheanceId] = useState('');
  const [motif, setMotif] = useState('');

  const recharger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      const [{ demandes: d }, c] = await Promise.all([
        fetchModificationsCredit(),
        peutProposer ? fetchCreditRequests('approuve', 500) : Promise.resolve([]),
      ]);
      setDemandes(d ?? []);
      setCredits(c ?? []);
    } catch (e) {
      setErreur(e.message ?? 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [peutProposer]);

  useEffect(() => { recharger(); }, [recharger]);

  const natureCourante = NATURES.find((n) => n.k === nature);

  const suggestions = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (q.length < 2) return [];
    return credits.filter((c) => (
      (c.client ?? '').toLowerCase().includes(q)
      || (c.reference ?? '').toLowerCase().includes(q)
      || (c.client_number ?? '').toLowerCase().includes(q)
    )).slice(0, 8);
  }, [recherche, credits]);

  // Les échéances du crédit choisi, pour désigner celle à prélever.
  // Seules les non payées sont proposées : prélever une échéance déjà
  // réglée n'a pas de sens, et le serveur la refuserait.
  const [echeances, setEcheances] = useState([]);
  useEffect(() => {
    if (!credit || nature !== 'prelevement_supplementaire') { setEcheances([]); return undefined; }
    let vivant = true;
    (async () => {
      try {
        const lignes = await fetchEcheancierCredit(credit.id);
        if (vivant) setEcheances(lignes.filter((e) => e.status !== 'payee'));
      } catch {
        if (vivant) setEcheances([]);
      }
    })();
    return () => { vivant = false; };
  }, [credit, nature]);

  const valide = useMemo(() => {
    if (!credit || motif.trim().length < 5) return false;
    if (nature === 'dates_echeances') return Number(jour) >= 1 && Number(jour) <= 28;
    if (nature === 'report_echeance') return Number(mois) >= 1 && Number(mois) <= 3;
    if (nature === 'montant') return Number(montant) > 0;
    if (nature === 'taux') return Number(taux) > 0;
    if (nature === 'prelevement_supplementaire') return Boolean(echeanceId);
    return false;
  }, [credit, motif, nature, jour, mois, montant, taux, echeanceId]);

  const reinitialiser = () => {
    setCredit(null); setRecherche(''); setMotif('');
    setMontant(''); setTaux(''); setEcheanceId('');
  };

  const deposer = async () => {
    setBusy('depot');
    setErreur('');
    try {
      const corps = { creditId: credit.id, nature, motif: motif.trim() };
      if (nature === 'dates_echeances') corps.jour = Number(jour);
      if (nature === 'report_echeance') corps.mois = Number(mois);
      if (nature === 'montant') corps.montantDepose = Number(montant);
      if (nature === 'taux') corps.tauxMensuel = Number(taux) / 100;
      if (nature === 'prelevement_supplementaire') corps.installmentId = echeanceId;
      await proposerModificationCredit(corps);
      reinitialiser();
      await recharger();
    } catch (e) {
      setErreur(e.message ?? 'Dépôt impossible.');
    } finally {
      setBusy(null);
    }
  };

  const agir = async (id, action) => {
    setBusy(id);
    setErreur('');
    try {
      if (action === 'accord') await accorderModificationCredit(id);
      else if (action === 'valider') await validerModificationCredit(id);
      else {
        const note = window.prompt('Motif du refus (5 caractères minimum) — le gestionnaire le lira :');
        if (!note || note.trim().length < 5) { setBusy(null); return; }
        await refuserModificationCredit(id, note.trim());
      }
      await recharger();
    } catch (e) {
      setErreur(e.message ?? 'Action impossible.');
    } finally {
      setBusy(null);
    }
  };

  const aAgir = demandes.filter((d) => (
    (peutAccorder && d.status === 'en_attente_operateur')
    || (peutDecider && d.status === 'en_attente_directeur')
  ));
  const enCours = demandes.filter((d) => d.status.startsWith('en_attente') && !aAgir.includes(d));
  const tranchees = demandes.filter((d) => !d.status.startsWith('en_attente'));

  return (
    <div>
      {erreur && (
        <Card style={{ marginBottom: 14, borderColor: colors.danger, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <AlertTriangle size={16} color={colors.danger} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, fontFamily: fonts.body, color: colors.text }}>{erreur}</div>
        </Card>
      )}

      {/* ── Ce qui attend une signature de ce poste ── */}
      {(peutAccorder || peutDecider) && (
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle right={(
            <button
              type="button"
              onClick={recharger}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, background: 'none',
                border: `1px solid ${colors.line}`, borderRadius: 8, padding: '5px 10px',
                color: colors.muted, fontSize: 12, fontFamily: fonts.body, cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} /> Actualiser
            </button>
          )}
          >
            {peutDecider ? 'À valider' : 'À accorder'}
            {aAgir.length > 0 && <Badge tone="gold">{aAgir.length}</Badge>}
          </SectionTitle>

          {chargement && <div style={{ fontSize: 13, color: colors.muted, fontFamily: fonts.body }}>Chargement…</div>}
          {!chargement && aAgir.length === 0 && (
            <div style={{ fontSize: 13, color: colors.muted, fontFamily: fonts.body }}>
              Rien n’attend votre signature.
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            {aAgir.map((d) => (
              <div key={d.id} style={{ border: `1px solid ${colors.line}`, borderRadius: 10, padding: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 14, fontFamily: fonts.body, color: colors.text, fontWeight: 600 }}>
                      {nomNature(d.kind)}
                    </div>
                    <div style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, marginTop: 3 }}>
                      {d.client} ({d.client_number}, {d.employeur}) — {d.reference}
                    </div>
                    <div style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
                      solde {formatFCFA(d.solde)} F · {d.echeances_restantes} échéance(s) restante(s)
                      {d.prochaine_echeance && ` · prochaine le ${d.prochaine_echeance}`}
                    </div>
                  </div>
                  <Badge tone={ETATS[d.status]?.tone}>{ETATS[d.status]?.libelle}</Badge>
                </div>

                <DetailDemande d={d} />
                <Chronologie d={d} />

                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {peutAccorder && d.status === 'en_attente_operateur' && (
                    <BoutonAction
                      onClick={() => agir(d.id, 'accord')}
                      busy={busy === d.id}
                      ton="vert"
                      icone={ArrowRight}
                      libelle="Donner mon accord"
                    />
                  )}
                  {peutDecider && d.status === 'en_attente_directeur' && (
                    <BoutonAction
                      onClick={() => agir(d.id, 'valider')}
                      busy={busy === d.id}
                      ton="vert"
                      icone={Check}
                      libelle="Valider et appliquer"
                    />
                  )}
                  <BoutonAction
                    onClick={() => agir(d.id, 'refuser')}
                    busy={busy === d.id}
                    ton="rouge"
                    icone={X}
                    libelle="Refuser"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Déposer une demande ── */}
      {peutProposer && (
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>Modifier un crédit en cours</SectionTitle>
          <div style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, marginBottom: 13 }}>
            Votre demande part à l’opérateur, qui donne son accord, puis au directeur, qui valide.
            Rien ne bouge sur le dossier avant ces deux signatures.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 9, marginBottom: 15 }}>
            {NATURES.map((n) => {
              const Icone = n.i;
              const choisie = nature === n.k;
              return (
                <button
                  key={n.k}
                  type="button"
                  onClick={() => { setNature(n.k); setEcheanceId(''); }}
                  style={{
                    textAlign: 'left', padding: 11, borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${choisie ? colors.primary : colors.line}`,
                    background: choisie ? `${colors.primary}0f` : colors.surface,
                  }}
                >
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 5 }}>
                    <Icone size={14} color={choisie ? colors.primary : colors.muted} />
                    <span style={{
                      fontSize: 13, fontFamily: fonts.body, fontWeight: 600,
                      color: choisie ? colors.primary : colors.text,
                    }}
                    >
                      {n.t}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body, lineHeight: 1.4 }}>
                    {n.d}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Le client */}
          <div style={{ marginBottom: 13, position: 'relative' }}>
            <label style={etiquette} htmlFor="gc-recherche">Client ou référence du crédit</label>
            {credit ? (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                border: `1px solid ${colors.line}`, borderRadius: 8, padding: '9px 11px',
              }}
              >
                <div style={{ fontSize: 13, fontFamily: fonts.body, color: colors.text }}>
                  <strong>{credit.client}</strong>
                  <span style={{ color: colors.muted }}>
                    {' '}({credit.client_number}) — {credit.reference}, {formatFCFA(credit.amount)} F
                    sur {credit.duration_months} mois
                  </span>
                </div>
                <button
                  type="button"
                  onClick={reinitialiser}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.muted }}
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={14}
                    color={colors.muted}
                    style={{ position: 'absolute', left: 10, top: 11 }}
                  />
                  <input
                    id="gc-recherche"
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    placeholder="Nom, numéro client, ou CPG-…"
                    style={{ ...champ, paddingLeft: 30 }}
                  />
                </div>
                {suggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', zIndex: 5, left: 0, right: 0, marginTop: 3,
                    background: colors.surface, border: `1px solid ${colors.line}`,
                    borderRadius: 8, overflow: 'hidden',
                  }}
                  >
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setCredit(c); setRecherche(''); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px',
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 13, fontFamily: fonts.body, color: colors.text,
                          borderBottom: `1px solid ${colors.line}`,
                        }}
                      >
                        {c.client} <span style={{ color: colors.muted }}>({c.client_number}) — {c.reference}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Le champ propre à la nature choisie */}
          {credit && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 11, marginBottom: 13 }}>
              {natureCourante.champs.includes('jour') && (
                <div>
                  <label style={etiquette} htmlFor="gc-jour">Nouveau jour du mois (1 à 28)</label>
                  <input
                    id="gc-jour"
                    type="number"
                    min="1"
                    max="28"
                    value={jour}
                    onChange={(e) => setJour(e.target.value)}
                    style={champ}
                  />
                </div>
              )}
              {natureCourante.champs.includes('mois') && (
                <div>
                  <label style={etiquette} htmlFor="gc-mois">Mois à sauter (1 à 3)</label>
                  <input
                    id="gc-mois"
                    type="number"
                    min="1"
                    max="3"
                    value={mois}
                    onChange={(e) => setMois(e.target.value)}
                    style={champ}
                  />
                </div>
              )}
              {natureCourante.champs.includes('montant') && (
                <div>
                  <label style={etiquette} htmlFor="gc-montant">Montant déposé par le client (F)</label>
                  <input
                    id="gc-montant"
                    type="number"
                    min="1"
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                    placeholder="Il doit déjà être sur son compte"
                    style={champ}
                  />
                </div>
              )}
              {natureCourante.champs.includes('taux') && (
                <div>
                  <label style={etiquette} htmlFor="gc-taux">Nouveau taux mensuel (%)</label>
                  <input
                    id="gc-taux"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={taux}
                    onChange={(e) => setTaux(e.target.value)}
                    placeholder="9.21"
                    style={champ}
                  />
                </div>
              )}
              {natureCourante.champs.includes('echeance') && (
                <div>
                  <label style={etiquette} htmlFor="gc-echeance">Échéance à prélever</label>
                  <select
                    id="gc-echeance"
                    value={echeanceId}
                    onChange={(e) => setEcheanceId(e.target.value)}
                    style={champ}
                  >
                    <option value="">— choisir —</option>
                    {echeances.map((e) => (
                      <option key={e.id} value={e.id}>
                        Échéance {e.sequence} — {formatFCFA(e.amount)} F, due le {String(e.due_date).slice(0, 10)}
                      </option>
                    ))}
                  </select>
                  {echeances.length === 0 && (
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body, marginTop: 5 }}>
                      Ce crédit n’a plus d’échéance à venir.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {credit && (
            <div style={{ marginBottom: 13 }}>
              <label style={etiquette} htmlFor="gc-motif">
                Motif — l’opérateur et le directeur ne liront que cela (5 caractères minimum)
              </label>
              <textarea
                id="gc-motif"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                rows={2}
                placeholder="Pourquoi cette modification est justifiée"
                style={{ ...champ, resize: 'vertical' }}
              />
            </div>
          )}

          <button
            type="button"
            onClick={deposer}
            disabled={!valide || busy === 'depot'}
            style={{
              padding: '10px 18px', borderRadius: 9, border: 'none',
              background: valide && busy !== 'depot' ? colors.primary : colors.line,
              color: valide && busy !== 'depot' ? '#fff' : colors.muted,
              fontSize: 13, fontFamily: fonts.body, fontWeight: 600,
              cursor: valide && busy !== 'depot' ? 'pointer' : 'not-allowed',
              opacity: valide && busy !== 'depot' ? 1 : 0.55,
            }}
          >
            {busy === 'depot' ? 'Envoi…' : 'Soumettre à l’opérateur'}
          </button>
        </Card>
      )}

      {/* ── Ce qui est en cours ailleurs ── */}
      {enCours.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>En cours de circuit <Badge tone="gold">{enCours.length}</Badge></SectionTitle>
          <div style={{ display: 'grid', gap: 11 }}>
            {enCours.map((d) => (
              <div key={d.id} style={{ border: `1px solid ${colors.line}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontFamily: fonts.body, color: colors.text }}>
                    <strong>{nomNature(d.kind)}</strong>
                    <span style={{ color: colors.muted }}> — {d.client}, {d.reference}</span>
                  </div>
                  <Badge tone={ETATS[d.status]?.tone}>{ETATS[d.status]?.libelle}</Badge>
                </div>
                <DetailDemande d={d} />
                <Chronologie d={d} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── L'historique ── */}
      <Card>
        <SectionTitle>Demandes tranchées</SectionTitle>
        {tranchees.length === 0 && (
          <div style={{ fontSize: 13, color: colors.muted, fontFamily: fonts.body }}>
            Aucune demande tranchée pour l’instant.
          </div>
        )}
        <div style={{ display: 'grid', gap: 11 }}>
          {tranchees.map((d) => (
            <div key={d.id} style={{ border: `1px solid ${colors.line}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontFamily: fonts.body, color: colors.text }}>
                  <strong>{nomNature(d.kind)}</strong>
                  <span style={{ color: colors.muted }}> — {d.client}, {d.reference}</span>
                </div>
                <Badge tone={ETATS[d.status]?.tone}>{ETATS[d.status]?.libelle}</Badge>
              </div>
              {d.status === 'approuve' && resumerEffet(d.kind, d.effet) && (
                <div style={{
                  marginTop: 8, padding: '8px 10px', borderRadius: 8,
                  background: `${colors.success}10`, fontSize: 12,
                  fontFamily: fonts.body, color: colors.text,
                }}
                >
                  {resumerEffet(d.kind, d.effet)}
                </div>
              )}
              <Chronologie d={d} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Ce que la demande demande, avant d'être appliquée. */
function DetailDemande({ d }) {
  const bouts = [];
  if (d.kind === 'dates_echeances') bouts.push(`passer au ${d.details.jour} du mois`);
  if (d.kind === 'report_echeance') {
    bouts.push(`sauter ${d.details.mois} mois`);
    if (d.details.frais_annonces) {
      bouts.push(`${formatFCFA(d.details.frais_annonces)} F d’intérêt de report`);
    }
  }
  if (d.kind === 'montant') bouts.push(`imputer ${formatFCFA(d.details.montant_depose)} F déposés`);
  if (d.kind === 'taux') bouts.push(`taux à ${(Number(d.details.taux_mensuel) * 100).toFixed(2)} %/mois`);
  if (d.kind === 'prelevement_supplementaire') bouts.push('encaisser une mensualité de plus');
  if (!bouts.length) return null;
  return (
    <div style={{
      marginTop: 8, padding: '7px 10px', borderRadius: 8,
      background: colors.surfaceAlt ?? `${colors.primary}08`,
      fontSize: 12, fontFamily: fonts.body, color: colors.text,
    }}
    >
      Demande : {bouts.join(', ')}
    </div>
  );
}

function BoutonAction({ onClick, busy, ton, icone: Icone, libelle }) {
  const vert = ton === 'vert';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 14px', borderRadius: 8,
        border: vert ? 'none' : `1px solid ${colors.danger}`,
        background: vert ? colors.primary : 'transparent',
        color: vert ? '#fff' : colors.danger,
        fontSize: 12.5, fontFamily: fonts.body, fontWeight: 600,
        cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
      }}
    >
      <Icone size={13} /> {libelle}
    </button>
  );
}
