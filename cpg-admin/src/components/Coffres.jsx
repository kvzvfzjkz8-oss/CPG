import React, { useState, useEffect } from 'react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from './UI';
import { fetchCoffres, transfererDepuisCoffre } from '../api/adminApi';

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
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const peutTransferer = role === 'directeur';

  const load = () => {
    fetchCoffres().then(setData).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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
              {formatFCFA(c.collecte)} F collectés au total
            </p>
          </Card>
        ))}
      </div>

      {peutTransferer && (
        <Card style={{ padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Transférer entre coffres
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
            D'un coffre vers un autre, ou vers la caisse principale de l'entreprise.
          </p>
          {toast && (
            <div style={{ background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: colors.goldDark, fontFamily: fonts.body }}>
              {toast}
            </div>
          )}
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
    </div>
  );
}
