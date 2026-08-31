import React, { useState, useEffect, useCallback } from 'react';
import { Search, Printer, Wallet, TrendingDown, Clock } from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, SectionTitle } from '../components/UI';
import {
  searchCaisseClient, fetchMaCaisse, fetchMesOperationsCaisse,
  demanderRetraitCaisse, demanderApproCaisse, fetchRib,
} from '../api/adminApi';

const actionBtn = (bg, fg) => ({
  padding: '10px 18px',
  borderRadius: 10,
  border: 'none',
  background: bg,
  color: fg,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: fonts.body,
  cursor: 'pointer',
});

export default function CaissierView() {
  const [tab, setTab] = useState('guichet');

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: 'guichet', label: 'Guichet', icon: Search },
          { key: 'caisse', label: 'Ma caisse', icon: Wallet },
        ]}
      />
      {tab === 'guichet' && <Guichet />}
      {tab === 'caisse' && <MaCaisse />}
    </div>
  );
}

function Guichet() {
  const [query, setQuery] = useState('');
  const [resultats, setResultats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [montant, setMontant] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [ribData, setRibData] = useState(null);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 6000);
  };

  useEffect(() => {
    if (query.trim().length < 2) {
      setResultats([]);
      return;
    }
    const timeout = setTimeout(() => {
      searchCaisseClient(query.trim()).then(setResultats).catch(() => setResultats([]));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const choisir = (client) => {
    setSelected(client);
    setResultats([]);
    setQuery('');
    setMontant('');
    setRibData(null);
  };

  const soumettreRetrait = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await demanderRetraitCaisse(selected.id, Number(montant));
      flash(`Demande de retrait de ${formatFCFA(Number(montant))} F déposée pour ${selected.full_name} — en attente de validation du directeur.`);
      setMontant('');
    } catch (err) {
      flash(err.message ?? 'Demande impossible.');
    } finally {
      setBusy(false);
    }
  };

  const imprimerRib = async () => {
    setBusy(true);
    try {
      const data = await fetchRib(selected.id);
      setRibData(data);
      setTimeout(() => window.print(), 150);
    } catch (err) {
      flash(err.message ?? 'RIB indisponible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {toast && (
        <div style={{
          background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.goldDark, fontFamily: fonts.body,
        }}>
          {toast}
        </div>
      )}

      {!selected && (
        <Card style={{ padding: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Rechercher un client
          </p>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom du client ou numéro de compte (CPG-...)"
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 10,
              border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body,
            }}
          />
          {resultats.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {resultats.map((r) => (
                <button
                  key={r.id}
                  onClick={() => choisir(r)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.line}`,
                    background: colors.bg, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                      {r.full_name}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                      {r.client_number}
                    </p>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                    {formatFCFA(r.balance)} F
                  </p>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {selected && (
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
                {selected.full_name}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
                {selected.client_number} · {selected.phone}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              style={{ border: 'none', background: 'transparent', color: colors.forestLight, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}
            >
              Changer de client
            </button>
          </div>

          <div style={{ background: colors.forestPale, borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 11, color: colors.forestLight, fontFamily: fonts.body }}>Solde disponible</p>
            <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: colors.forest, fontFamily: fonts.mono }}>
              {formatFCFA(selected.balance)} F
            </p>
          </div>

          <form onSubmit={soumettreRetrait} style={{ marginBottom: 16 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
              Effectuer un retrait caisse
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="number"
                min="500"
                max={selected.balance}
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
                placeholder="Montant à retirer (FCFA)"
                required
                style={{
                  flex: 1, padding: '11px 14px', borderRadius: 10,
                  border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.mono,
                }}
              />
              <button type="submit" disabled={busy || !montant} style={actionBtn(colors.forest, '#fff')}>
                Valider la demande
              </button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              La demande sera soumise au directeur avant tout débit réel du compte.
            </p>
          </form>

          <button onClick={imprimerRib} disabled={busy} style={{ ...actionBtn(colors.card, colors.ink), border: `1px solid ${colors.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Printer size={14} /> Demande de RIB
          </button>
        </Card>
      )}

      {ribData && (
        <div className="rib-print-only">
          <h2>Crédit Populaire du Gabon</h2>
          <p><strong>Relevé d'identité de compte</strong></p>
          <table>
            <tbody>
              <tr><td>Titulaire</td><td>{ribData.full_name}</td></tr>
              <tr><td>Numéro de compte</td><td>{ribData.client_number}</td></tr>
              <tr><td>Téléphone</td><td>{ribData.phone}</td></tr>
              <tr><td>Gestionnaire</td><td>{ribData.gestionnaire ?? '—'}</td></tr>
              <tr><td>Édité le</td><td>{new Date().toLocaleDateString('fr-FR')}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <style>{`
        .rib-print-only { display: none; }
        @media print {
          body * { visibility: hidden; }
          .rib-print-only, .rib-print-only * { visibility: visible; }
          .rib-print-only { display: block; position: absolute; top: 0; left: 0; padding: 40px; }
          .rib-print-only table { border-collapse: collapse; margin-top: 20px; }
          .rib-print-only td { padding: 8px 16px; border: 1px solid #ccc; }
        }
      `}</style>
    </div>
  );
}

function MaCaisse() {
  const [info, setInfo] = useState(null);
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAppro, setShowAppro] = useState(false);
  const [approMontant, setApproMontant] = useState('');
  const [approMotif, setApproMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 6000);
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchMaCaisse(), fetchMesOperationsCaisse()])
      .then(([caisse, ops]) => {
        setInfo(caisse);
        setOperations(ops);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const soumettreAppro = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await demanderApproCaisse(Number(approMontant), approMotif || undefined);
      flash('Demande de réapprovisionnement envoyée au directeur.');
      setApproMontant('');
      setApproMotif('');
      setShowAppro(false);
      load();
    } catch (err) {
      flash(err.message ?? 'Demande impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !info) {
    return <Card style={{ padding: 40, textAlign: 'center' }}>Chargement…</Card>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toast && (
        <div style={{
          background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 12,
          padding: '11px 16px', fontSize: 12, color: colors.goldDark, fontFamily: fonts.body,
        }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Wallet size={14} color={colors.forestLight} />
            <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Solde de la caisse</p>
          </div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.ink, fontFamily: fonts.mono }}>
            {formatFCFA(info.solde)} F
          </p>
        </Card>
        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <TrendingDown size={14} color={colors.danger} />
            <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Retiré aujourd'hui</p>
          </div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.ink, fontFamily: fonts.mono }}>
            {formatFCFA(info.retraitsAujourdhui.total)} F
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
            {info.retraitsAujourdhui.nombre} opération{info.retraitsAujourdhui.nombre > 1 ? 's' : ''}
          </p>
        </Card>
        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Clock size={14} color={colors.goldDark} />
            <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>En attente</p>
          </div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.ink, fontFamily: fonts.mono }}>
            {info.demandesEnAttente}
          </p>
        </Card>
      </div>

      {showAppro ? (
        <Card style={{ padding: 18 }}>
          <form onSubmit={soumettreAppro}>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
              Demander un réapprovisionnement
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <input
                type="number" min="1000" required
                value={approMontant}
                onChange={(e) => setApproMontant(e.target.value)}
                placeholder="Montant demandé (FCFA)"
                style={{ flex: 1, padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.mono }}
              />
            </div>
            <input
              value={approMotif}
              onChange={(e) => setApproMotif(e.target.value)}
              placeholder="Motif (optionnel)"
              style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={busy} style={actionBtn(colors.forest, '#fff')}>Envoyer la demande</button>
              <button type="button" onClick={() => setShowAppro(false)} style={actionBtn('transparent', colors.muted)}>Annuler</button>
            </div>
          </form>
        </Card>
      ) : (
        <button onClick={() => setShowAppro(true)} style={{ ...actionBtn(colors.gold, colors.forest), alignSelf: 'flex-start' }}>
          + Demander un réapprovisionnement
        </button>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>Historique de mes demandes</SectionTitle>
        {operations.length === 0 && (
          <p style={{ padding: 24, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucune demande pour le moment.
          </p>
        )}
        {operations.map((op) => (
          <div
            key={op.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 20px', borderBottom: `1px solid ${colors.line}`,
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                {op.type === 'appro' ? 'Réapprovisionnement' : `Retrait — ${op.client}`}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                {new Date(op.demandee_le).toLocaleString('fr-FR')}
                {op.statut === 'rejetee' && op.motif_rejet ? ` · ${op.motif_rejet}` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                {formatFCFA(op.montant)} F
              </p>
              <Badge tone={op.statut === 'validee' ? 'neutral' : op.statut === 'rejetee' ? 'danger' : 'gold'}>
                {op.statut === 'validee' ? 'Validée' : op.statut === 'rejetee' ? 'Rejetée' : 'En attente'}
              </Badge>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
