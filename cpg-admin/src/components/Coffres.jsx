import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from './UI';
import { fetchCoffres, transfererDepuisCoffre, cloturerCoffre, fetchCoffreClotures, fetchEcheancesAttendues, fetchCoffreParMois } from '../api/adminApi';

const NOMS_MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function moisSuivant(mois, delta) {
  const [annee, m] = mois.split('-').map(Number);
  const d = new Date(Date.UTC(annee, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function libelleMois(mois) {
  const [annee, m] = mois.split('-').map(Number);
  return `${NOMS_MOIS[m - 1]} ${annee}`;
}

/**
 * Détail mois par mois d'un coffre — d'abord le total global (celui
 * déjà affiché sur la tuile), puis la répartition par mois calendaire
 * en dessous, du plus récent au plus ancien. Répond au besoin du
 * directeur de voir clairement ce qui est rentré, mois par mois, pas
 * seulement un chiffre global agrégé.
 */
function CoffreParMoisModal({ coffre, label, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCoffreParMois(coffre).then(setData).finally(() => setLoading(false));
  }, [coffre]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,30,25,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto', zIndex: 100,
      }}
    >
      <Card onClick={(e) => e.stopPropagation()} style={{ padding: 0, overflow: 'hidden', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <SectionTitle
          right={
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: colors.muted }}>
              <X size={16} />
            </button>
          }
        >
          {label} — détail par mois
        </SectionTitle>

        {loading || !data ? (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>Chargement…</p>
        ) : (
          <>
            <div style={{ padding: '16px 20px', textAlign: 'center', borderBottom: `1px solid ${colors.line}` }}>
              <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Total {data.periodeDepuis ? 'depuis la dernière clôture' : 'depuis le début'}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: colors.forest, fontFamily: fonts.mono }}>
                {formatFCFA(data.total)} F
              </p>
            </div>

            {data.parMois.length === 0 ? (
              <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
                Aucun mouvement sur la période.
              </p>
            ) : (
              data.parMois.map((m) => (
                <div key={m.mois} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${colors.line}` }}>
                  <p style={{ margin: 0, fontSize: 13, color: colors.ink, fontFamily: fonts.body, textTransform: 'capitalize' }}>
                    {libelleMois(m.mois)}
                  </p>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                      {formatFCFA(m.total)} F
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: colors.muted, fontFamily: fonts.body }}>
                      {m.nombre} mouvement{m.nombre > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * Détail des échéances attendues pour un mois donné — ouvert en
 * cliquant sur le coffre « Remboursements ». Le directeur peut
 * changer de mois (octobre par défaut au moment de la demande).
 */
function EcheancesAttenduesModal({ moisInitial, onClose }) {
  const [mois, setMois] = useState(moisInitial);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchEcheancesAttendues(mois).then(setData).finally(() => setLoading(false));
  }, [mois]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,30,25,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto', zIndex: 100,
      }}
    >
      <Card onClick={(e) => e.stopPropagation()} style={{ padding: 0, overflow: 'hidden', width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
        <SectionTitle
          right={
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: colors.muted }}>
              <X size={16} />
            </button>
          }
        >
          Échéances attendues — {libelleMois(mois)}
        </SectionTitle>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '4px 20px 14px' }}>
          <button
            onClick={() => setMois((m) => moisSuivant(m, -1))}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: colors.muted, display: 'flex' }}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>{libelleMois(mois)}</span>
          <button
            onClick={() => setMois((m) => moisSuivant(m, 1))}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: colors.muted, display: 'flex' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {loading || !data ? (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>Chargement…</p>
        ) : (
          <>
            <div style={{ padding: '0 20px 16px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: colors.forest, fontFamily: fonts.mono }}>
                {formatFCFA(data.total)} F
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
                attendus sur {data.nombre} échéance{data.nombre > 1 ? 's' : ''} pas encore prélevée{data.nombre > 1 ? 's' : ''}
              </p>
            </div>

            {data.echeances.length === 0 ? (
              <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
                Aucune échéance attendue ce mois-ci.
              </p>
            ) : (
              <div style={{ borderTop: `1px solid ${colors.line}` }}>
                {data.echeances.map((e) => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 20px', borderBottom: `1px solid ${colors.line}` }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>{e.client}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                        {e.reference} · échéance n°{e.sequence} · {new Date(e.dueDate).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                      {formatFCFA(e.amount)} F
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

const LABELS = {
  frais_agios: 'Frais & agios',
  remboursements: 'Remboursements',
  frais_dossier: 'Frais de dossier',
  caisse_principale: 'Caisse principale',
};

/**
 * Les trois coffres de l'entreprise — lecture pour la caissière et le
 * directeur ; les transferts (entre coffres, ou vers la caisse
 * principale) restent réservés au directeur.
 */
export function CoffresPanel({ role }) {
  const [data, setData] = useState(null);
  const [clotures, setClotures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [clotureBusy, setClotureBusy] = useState(null);
  const [echeancesOuvertes, setEcheancesOuvertes] = useState(false);
  const [coffreParMoisOuvert, setCoffreParMoisOuvert] = useState(null);

  const peutTransferer = role === 'directeur';
  const peutCloturer = role === 'directeur';

  const load = () => {
    fetchCoffres().then(setData).finally(() => setLoading(false));
    fetchCoffreClotures().then(setClotures).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const cloturer = async (c) => {
    if (!window.confirm(
      `Clôturer le coffre « ${LABELS[c.type]} » ?\n\nLe solde actuel (${formatFCFA(c.solde)} F) sera archivé dans l'historique, et le coffre repartira de zéro.`
    )) return;
    setClotureBusy(c.type);
    setError('');
    try {
      const result = await cloturerCoffre(c.type);
      setToast(`${LABELS[c.type]} clôturé — ${formatFCFA(result.montant)} F archivés.`);
      setTimeout(() => setToast(''), 5000);
      load();
    } catch (err) {
      setError(err.message ?? 'Clôture impossible.');
    } finally {
      setClotureBusy(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!source || !destination || !montant) return;
    setBusy(true);
    setError('');
    try {
      await transfererDepuisCoffre(source, destination, Number(montant), motif.trim() || undefined);
      setToast(`${formatFCFA(Number(montant))} F transférés — ${LABELS[source]} → ${LABELS[destination]}.`);
      setTimeout(() => setToast(''), 5000);
      setSource(''); setDestination(''); setMontant(''); setMotif('');
      load();
    } catch (err) {
      setError(err.message ?? 'Transfert impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !data) {
    return <Card style={{ padding: 40, textAlign: 'center' }}>Chargement…</Card>;
  }

  const destinationsPossibles = ['frais_agios', 'remboursements', 'frais_dossier', 'caisse_principale']
    .filter((d) => d !== source);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toast && (
        <div style={{ background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: colors.goldDark, fontFamily: fonts.body }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {data.coffres.map((c) => (
          <Card key={c.type} style={{ padding: 18 }}>
            <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {LABELS[c.type]}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, color: colors.forest, fontFamily: fonts.mono }}>
              {formatFCFA(c.solde)} F
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {formatFCFA(c.collecte)} F collectés{c.periodeDepuis ? ' depuis la dernière clôture' : ' au total'}
            </p>
            {c.periodeDepuis && (
              <p style={{ margin: '2px 0 0', fontSize: 10, color: colors.muted, fontFamily: fonts.body }}>
                Depuis le {new Date(c.periodeDepuis).toLocaleDateString('fr-FR')}
              </p>
            )}
            <button
              onClick={() => setCoffreParMoisOuvert(c.type)}
              style={{
                marginTop: 10, width: '100%', padding: '7px 12px', borderRadius: 8,
                border: `1px solid ${colors.line}`, background: '#fff', color: colors.forest,
                fontSize: 11, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer',
              }}
            >
              Détail par mois
            </button>
            {c.type === 'remboursements' && (
              <button
                onClick={() => setEcheancesOuvertes(true)}
                style={{
                  marginTop: 12, width: '100%', padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${colors.line}`, background: colors.goldPale, color: colors.goldDark,
                  fontSize: 11, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer',
                }}
              >
                Voir les prochaines échéances attendues
              </button>
            )}
            {peutCloturer && (
              <button
                onClick={() => cloturer(c)}
                disabled={clotureBusy === c.type}
                style={{
                  marginTop: 8, width: '100%', padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${colors.line}`, background: '#fff', color: colors.ink,
                  fontSize: 11, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer',
                }}
              >
                {clotureBusy === c.type ? 'Clôture…' : 'Clôturer ce mois'}
              </button>
            )}
          </Card>
        ))}
      </div>

      {echeancesOuvertes && (
        <EcheancesAttenduesModal
          moisInitial={moisSuivant(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, 1)}
          onClose={() => setEcheancesOuvertes(false)}
        />
      )}

      {coffreParMoisOuvert && (
        <CoffreParMoisModal
          coffre={coffreParMoisOuvert}
          label={LABELS[coffreParMoisOuvert]}
          onClose={() => setCoffreParMoisOuvert(null)}
        />
      )}

      {peutTransferer && (
        <Card style={{ padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Transférer entre coffres
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
            D'un coffre vers un autre, ou vers la caisse principale de l'entreprise.
          </p>
          <form onSubmit={submit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Depuis</label>
              <select
                value={source} onChange={(e) => { setSource(e.target.value); if (e.target.value === destination) setDestination(''); }}
                style={{ display: 'block', padding: '9px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, marginTop: 6, minWidth: 160 }}
              >
                <option value="">Choisir…</option>
                {data.coffres.map((c) => <option key={c.type} value={c.type}>{LABELS[c.type]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Vers</label>
              <select
                value={destination} onChange={(e) => setDestination(e.target.value)}
                disabled={!source}
                style={{ display: 'block', padding: '9px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, marginTop: 6, minWidth: 160 }}
              >
                <option value="">Choisir…</option>
                {destinationsPossibles.map((d) => <option key={d} value={d}>{LABELS[d]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Montant (FCFA)</label>
              <input
                type="number" value={montant} onChange={(e) => setMontant(e.target.value)}
                style={{ display: 'block', padding: '9px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, marginTop: 6, width: 140 }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Motif (optionnel)</label>
              <input
                value={motif} onChange={(e) => setMotif(e.target.value)}
                style={{ display: 'block', width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, marginTop: 6 }}
              />
            </div>
            <button
              type="submit"
              disabled={!source || !destination || !montant || busy}
              style={{
                padding: '10px 18px', borderRadius: 9, border: 'none', background: colors.forest, color: '#fff',
                fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer', opacity: (!source || !destination || !montant) ? 0.5 : 1,
              }}
            >
              {busy ? 'Transfert…' : 'Transférer'}
            </button>
          </form>
          {error && <p style={{ margin: '10px 0 0', fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{error}</p>}
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>Derniers mouvements</SectionTitle>
        {data.mouvements.length === 0 ? (
          <p style={{ padding: 24, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucun transfert pour le moment.
          </p>
        ) : (
          data.mouvements.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${colors.line}` }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>
                  {LABELS[m.coffre_source] ?? m.coffre_source} → {LABELS[m.destination] ?? m.destination}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  {m.motif ?? '—'} · par {m.cree_par} · {new Date(m.created_at).toLocaleDateString('fr-FR')}
                </p>
              </div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                {formatFCFA(m.montant)} F
              </p>
            </div>
          ))
        )}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>Historique des clôtures</SectionTitle>
        {clotures.length === 0 ? (
          <p style={{ padding: 24, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucun coffre clôturé pour le moment.
          </p>
        ) : (
          clotures.map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${colors.line}` }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>
                  {LABELS[c.coffre] ?? c.coffre}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  Période du {new Date(c.periode_debut).toLocaleDateString('fr-FR')} au {new Date(c.periode_fin).toLocaleDateString('fr-FR')}
                  {' '}· clôturé par {c.cloturee_par}
                </p>
              </div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                {formatFCFA(c.montant)} F
              </p>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
