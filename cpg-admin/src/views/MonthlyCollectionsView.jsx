/**
 * ─────────────────────────────────────────────────────────────────────
 *  PRÉLÈVEMENTS DU MOIS — PILOTÉS PAR L'OPÉRATEUR
 * ─────────────────────────────────────────────────────────────────────
 *
 * Le prélèvement automatique passe sur tout le monde d'un coup. Dans
 * les faits, les salaires des entreprises partenaires n'arrivent pas
 * le même jour : l'opérateur a besoin de voir qui est prélevable
 * maintenant, entreprise par entreprise, et de lancer les
 * prélèvements au fur et à mesure.
 *
 * Les lignes sont groupées par employeur — chercher le nom d'une
 * entreprise sort tous ses agents, et une case en tête de groupe les
 * sélectionne tous d'un coup.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Wallet, Check, AlertTriangle, Clock, Building2, RefreshCw, CheckCheck,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from '../components/UI';
import { fetchMonthInstallments, preleverEcheances } from '../api/adminApi';

const SANS_EMPLOYEUR = 'Sans employeur renseigné';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMois(mois) {
  if (!mois) return '';
  const [annee, m] = mois.split('-');
  const d = new Date(Date.UTC(Number(annee), Number(m) - 1, 1));
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** « d'octobre », « de novembre » — avril, août et octobre prennent l'élision. */
function moisAvecPreposition(mois) {
  const libelle = formatMois(mois);
  if (!libelle) return '';
  return /^[aeiouyàâéèêîôû]/i.test(libelle) ? `d’${libelle}` : `de ${libelle}`;
}

/** Ce qui empêche de prélever une ligne, en clair. Null si elle est prélevable. */
function blocage(e) {
  if (e.status === 'payee') return 'Déjà prélevée';
  if (e.credit_status !== 'approuve') {
    return e.credit_status === 'suspendu' ? 'Crédit suspendu' : 'Crédit clôturé';
  }
  if (!e.provision_suffisante) return 'Provision insuffisante';
  return null;
}

function Tuile({ libelle, valeur, couleur }) {
  return (
    <Card style={{ padding: '14px 18px', flex: '1 1 170px' }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {libelle}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 600, color: couleur ?? colors.ink, fontFamily: fonts.display }}>
        {valeur}
      </p>
    </Card>
  );
}

export default function MonthlyCollectionsView({ onChanged }) {
  const [donnees, setDonnees] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [rechercheActive, setRechercheActive] = useState('');
  const [selection, setSelection] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');
  const [compteRendu, setCompteRendu] = useState(null);

  const charger = (q = rechercheActive) => {
    setLoading(true);
    fetchMonthInstallments(q)
      .then((d) => { setDonnees(d); setSelection(new Set()); })
      .catch((e) => setErreur(e.message ?? 'Chargement impossible.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { charger(''); }, []);

  const lancerRecherche = (e) => {
    e?.preventDefault();
    setRechercheActive(recherche);
    setErreur('');
    charger(recherche);
  };

  const echeances = donnees?.echeances ?? [];

  /** Regroupées par employeur, dans l'ordre déjà trié par l'API. */
  const groupes = useMemo(() => {
    const parEmployeur = new Map();
    for (const e of echeances) {
      const cle = e.employer?.trim() || SANS_EMPLOYEUR;
      if (!parEmployeur.has(cle)) parEmployeur.set(cle, []);
      parEmployeur.get(cle).push(e);
    }
    return [...parEmployeur.entries()];
  }, [echeances]);

  const prelevables = echeances.filter((e) => e.prelevable && !blocage(e));

  const basculer = (id) => {
    setSelection((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id); else suivant.add(id);
      return suivant;
    });
  };

  const basculerGroupe = (lignes) => {
    const ids = lignes.filter((e) => !blocage(e)).map((e) => e.id);
    const toutesCochees = ids.length > 0 && ids.every((id) => selection.has(id));
    setSelection((prev) => {
      const suivant = new Set(prev);
      for (const id of ids) { if (toutesCochees) suivant.delete(id); else suivant.add(id); }
      return suivant;
    });
  };

  const prelever = async (ids) => {
    if (ids.length === 0) return;
    setBusy(true);
    setErreur('');
    setCompteRendu(null);
    try {
      const r = await preleverEcheances(ids);
      setCompteRendu(r);
      charger();
      onChanged?.();
    } catch (e) {
      setErreur(e.message ?? 'Le prélèvement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const t = donnees?.totaux;

  return (
    <div>
      {/* ── Recherche ──────────────────────────────────────────── */}
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          Prélèvements {moisAvecPreposition(donnees?.mois)}
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Les échéances du mois, les retards des mois précédents, et ce qui a déjà été prélevé.
          Cherchez une entreprise pour sortir tous ses agents, puis lancez les prélèvements —
          individuellement ou d’un coup.
        </p>
        <form onSubmit={lancerRecherche} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 320px' }}>
            <Search size={14} color={colors.muted} style={{ position: 'absolute', left: 11, top: 11 }} />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Entreprise, nom du client, n° client ou référence du crédit…"
              style={{
                padding: '9px 11px 9px 32px', borderRadius: 9, border: `1px solid ${colors.line}`,
                fontSize: 12, fontFamily: fonts.body, outline: 'none', width: '100%', boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9,
              border: 'none', background: colors.forest, color: '#fff', fontSize: 12, fontWeight: 600,
              fontFamily: fonts.body, cursor: 'pointer',
            }}
          >
            <Search size={12} /> Chercher
          </button>
          {rechercheActive && (
            <button
              type="button"
              onClick={() => { setRecherche(''); setRechercheActive(''); charger(''); }}
              style={{
                padding: '9px 14px', borderRadius: 9, border: `1px solid ${colors.line}`,
                background: '#fff', color: colors.muted, fontSize: 12, fontWeight: 600,
                fontFamily: fonts.body, cursor: 'pointer',
              }}
            >
              Tout afficher
            </button>
          )}
          <button
            type="button"
            onClick={() => charger()}
            title="Recharger"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9,
              border: `1px solid ${colors.line}`, background: '#fff', color: colors.muted,
              fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer',
            }}
          >
            <RefreshCw size={12} />
          </button>
        </form>
      </Card>

      {/* ── Compteurs ──────────────────────────────────────────── */}
      {t && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <Tuile libelle="À prélever" valeur={String(t.aPrelever)} />
          <Tuile libelle="Montant à prélever" valeur={`${formatFCFA(t.montantAPrelever)} F`} />
          <Tuile libelle="Sans provision" valeur={String(t.sansProvision)} couleur={t.sansProvision ? colors.danger : undefined} />
          <Tuile libelle="En retard" valeur={String(t.enRetard)} couleur={t.enRetard ? colors.danger : undefined} />
          <Tuile libelle="Déjà prélevées" valeur={String(t.dejaPrelevees)} couleur={colors.forestLight} />
        </div>
      )}

      {erreur && (
        <div style={{
          background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.danger,
          fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={14} /> {erreur}
        </div>
      )}

      {/* ── Compte rendu du dernier prélèvement ────────────────── */}
      {compteRendu && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            {compteRendu.preleves.length} échéance{compteRendu.preleves.length > 1 ? 's' : ''} prélevée
            {compteRendu.preleves.length > 1 ? 's' : ''} — {formatFCFA(compteRendu.totalPreleve)} F
          </p>
          {compteRendu.preleves.some((p) => p.creditSolde) && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: colors.forestLight, fontFamily: fonts.body, fontWeight: 600 }}>
              {compteRendu.preleves.filter((p) => p.creditSolde).length} crédit(s) entièrement soldé(s) :{' '}
              {compteRendu.preleves.filter((p) => p.creditSolde).map((p) => p.reference).join(', ')}
            </p>
          )}
          {compteRendu.echecs.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: colors.danger, fontFamily: fonts.body }}>
                {compteRendu.echecs.length} non prélevée{compteRendu.echecs.length > 1 ? 's' : ''} :
              </p>
              {compteRendu.echecs.map((e, i) => (
                <p key={`${e.id}-${i}`} style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  {e.client ?? '—'} {e.reference ? `· ${e.reference}` : ''} — {e.motif}
                  {e.soldeDisponible !== undefined ? ` (solde ${formatFCFA(e.soldeDisponible)} F)` : ''}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Barre de sélection ─────────────────────────────────── */}
      {selection.size > 0 && (
        <Card style={{
          padding: '12px 18px', marginBottom: 16, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            {selection.size} échéance{selection.size > 1 ? 's' : ''} sélectionnée{selection.size > 1 ? 's' : ''}
            {' — '}
            {formatFCFA(echeances.filter((e) => selection.has(e.id)).reduce((s, e) => s + Number(e.amount), 0))} F
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setSelection(new Set())}
              style={{
                padding: '8px 14px', borderRadius: 9, border: `1px solid ${colors.line}`,
                background: '#fff', color: colors.muted, fontSize: 12, fontWeight: 600,
                fontFamily: fonts.body, cursor: 'pointer',
              }}
            >
              Tout décocher
            </button>
            <button
              onClick={() => prelever([...selection])}
              disabled={busy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9,
                border: 'none', background: colors.forest, color: '#fff', fontSize: 12, fontWeight: 600,
                fontFamily: fonts.body, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              <CheckCheck size={13} /> {busy ? 'Prélèvement…' : 'Prélever la sélection'}
            </button>
          </div>
        </Card>
      )}

      {/* ── Liste groupée par entreprise ───────────────────────── */}
      {loading && !donnees && <Card style={{ padding: 40, textAlign: 'center' }}>Chargement…</Card>}

      {donnees && echeances.length === 0 && (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: colors.muted, fontFamily: fonts.body }}>
            {rechercheActive
              ? `Aucune échéance ne correspond à « ${rechercheActive} » ce mois-ci.`
              : 'Aucune échéance à prélever ce mois-ci.'}
          </p>
        </Card>
      )}

      {groupes.map(([employeur, lignes]) => {
        const selectionnables = lignes.filter((e) => !blocage(e));
        const toutesCochees = selectionnables.length > 0
          && selectionnables.every((e) => selection.has(e.id));
        const montantGroupe = selectionnables.reduce((s, e) => s + Number(e.amount), 0);

        return (
          <Card key={employeur} style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
            <SectionTitle
              right={
                selectionnables.length > 0 ? (
                  <button
                    onClick={() => prelever(selectionnables.map((e) => e.id))}
                    disabled={busy}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
                      border: 'none', background: colors.forest, color: '#fff', fontSize: 11, fontWeight: 600,
                      fontFamily: fonts.body, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <Wallet size={12} /> Tout prélever ({formatFCFA(montantGroupe)} F)
                  </button>
                ) : undefined
              }
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {selectionnables.length > 0 && (
                  <input
                    type="checkbox"
                    checked={toutesCochees}
                    onChange={() => basculerGroupe(lignes)}
                    title="Sélectionner tous les agents de cette entreprise"
                    style={{ cursor: 'pointer' }}
                  />
                )}
                <Building2 size={14} color={colors.forest} />
                {employeur} · {lignes.length} échéance{lignes.length > 1 ? 's' : ''}
              </span>
            </SectionTitle>

            {lignes.map((e) => {
              const raison = blocage(e);
              const enRetard = e.status === 'en_retard';
              const payee = e.status === 'payee';
              return (
                <div
                  key={e.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 20px', borderBottom: `1px solid ${colors.line}`,
                    background: payee ? colors.bg : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selection.has(e.id)}
                    disabled={!!raison}
                    onChange={() => basculer(e.id)}
                    style={{ cursor: raison ? 'not-allowed' : 'pointer' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                        {e.client}
                      </p>
                      {enRetard && <Badge tone="danger">En retard</Badge>}
                      {payee && <Badge tone="neutral">Prélevée</Badge>}
                    </div>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                      {e.reference} · échéance {e.sequence}/{e.duration_months} · due le {formatDate(e.due_date)}
                      {e.client_number ? ` · n° ${e.client_number}` : ''}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, fontFamily: fonts.body, color: raison && !payee ? colors.danger : colors.muted }}>
                      Solde du compte : {formatFCFA(e.solde)} F
                      {raison ? ` — ${raison}` : ''}
                    </p>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
                    {formatFCFA(e.amount)} F
                  </p>
                  <span style={{ flexShrink: 0, width: 108, display: 'flex', justifyContent: 'flex-end' }}>
                    {payee ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: colors.forestLight, fontFamily: fonts.body, fontWeight: 600 }}>
                        <Check size={13} /> {formatDate(e.paid_at)}
                      </span>
                    ) : raison ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                        <Clock size={12} /> impossible
                      </span>
                    ) : (
                      <button
                        onClick={() => prelever([e.id])}
                        disabled={busy}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8,
                          border: 'none', background: colors.forest, color: '#fff', fontSize: 11, fontWeight: 600,
                          fontFamily: fonts.body, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                        }}
                      >
                        <Wallet size={12} /> Prélever
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </Card>
        );
      })}

      {prelevables.length > 0 && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body, textAlign: 'center' }}>
          {prelevables.length} échéance{prelevables.length > 1 ? 's' : ''} prélevable
          {prelevables.length > 1 ? 's' : ''} actuellement.
        </p>
      )}
    </div>
  );
}
