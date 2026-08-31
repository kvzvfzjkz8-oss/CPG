import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Printer, Wallet, TrendingDown, TrendingUp, Clock, ArrowDownCircle,
  ArrowUpCircle, ShoppingBag, Banknote, Lock, CheckCircle2,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from '../components/UI';
import {
  searchCaisseClient, fetchMaCaisse, fetchMesOperationsCaisse,
  demanderRetraitCaisse, demanderApproCaisse, fetchRib,
  demanderDepenseCaisse, encaisserClient,
  fetchClotureDuJour, cloturerCaisse,
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

const OPERATIONS = [
  { key: 'retrait_client', label: 'Paiement à un client', icon: ArrowUpCircle, needsClient: true, tone: colors.danger },
  { key: 'encaissement_client', label: "Réception d'un client", icon: ArrowDownCircle, needsClient: true, tone: colors.forestLight },
  { key: 'depense', label: 'Dépense de fonctionnement', icon: ShoppingBag, needsClient: false, tone: colors.danger },
  { key: 'appro', label: 'Demander un réapprovisionnement', icon: Banknote, needsClient: false, tone: colors.goldDark },
];

const OP_LABELS = {
  retrait_client: 'Paiement client',
  encaissement_client: "Réception d'un client",
  depense: 'Dépense de fonctionnement',
  appro: 'Réapprovisionnement',
  retour_excedent: 'Excédent renvoyé (clôture)',
};

export default function CaissierView() {
  const [info, setInfo] = useState(null);
  const [cloture, setCloture] = useState(null);
  const [clotureBusy, setClotureBusy] = useState(false);
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeOp, setActiveOp] = useState(null); // 'retrait_client' | 'encaissement_client' | 'depense' | 'appro' | null
  const [toast, setToast] = useState('');
  const [reminderPulse, setReminderPulse] = useState(0); // change de valeur = redéclenche l'animation

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 6000);
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchMaCaisse(), fetchMesOperationsCaisse(), fetchClotureDuJour()])
      .then(([caisse, ops, clotureInfo]) => {
        setInfo(caisse);
        setOperations(ops);
        setCloture(clotureInfo);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const doCloture = async () => {
    setClotureBusy(true);
    try {
      await cloturerCaisse();
      load();
    } catch (err) {
      flash(err.message ?? 'Clôture impossible.');
    } finally {
      setClotureBusy(false);
    }
  };

  // Rappel de clôture : à partir de 15h00, tant que la caisse n'est
  // pas fermée, une alerte revient toutes les 5 minutes — à l'écran
  // dans tous les cas, et via une vraie notification système du
  // navigateur si la caissière a accordé la permission (fonctionne
  // même onglet en arrière-plan, tant que le navigateur reste ouvert ;
  // une vraie notification serveur qui arrive même navigateur fermé
  // demanderait une infrastructure séparée, pas encore en place).
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!info || cloture?.cloture) return; // déjà clôturée : plus de rappel à faire

    const alerte = () => {
      const maintenant = new Date();
      if (maintenant.getHours() < 15) return; // pas avant 15h00

      setReminderPulse((n) => n + 1);
      flash('⏰ Il est temps de clôturer votre caisse.');

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('CPG — Clôture de caisse', {
          body: "N'oubliez pas de clôturer votre caisse avant de partir.",
          tag: 'cpg-cloture-rappel', // remplace la précédente plutôt que d'empiler les alertes
        });
      }
    };

    alerte(); // un premier rappel immédiat si on est déjà après 15h00
    const interval = setInterval(alerte, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [info, cloture]);

  const closeForm = (message) => {
    setActiveOp(null);
    if (message) flash(message);
    load();
  };

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

      {/* Solde bien visible en tête de page, comme demandé. */}
      <Card style={{ padding: 22, background: colors.forest }}>
        <p style={{ margin: 0, fontSize: 11, color: colors.onForest ?? '#B7CFC2', fontFamily: fonts.body }}>
          Solde de ma caisse
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 32, fontWeight: 700, color: '#fff', fontFamily: fonts.mono }}>
          {loading ? '—' : `${formatFCFA(info.solde)} F`}
        </p>
        {!loading && (
          <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
            <div>
              <p style={{ margin: 0, fontSize: 10, color: '#B7CFC2', fontFamily: fonts.body }}>Payé aujourd'hui</p>
              <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#fff', fontFamily: fonts.mono }}>
                {formatFCFA(info.bilanJour.retraits + info.bilanJour.depenses)} F
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 10, color: '#B7CFC2', fontFamily: fonts.body }}>Reçu aujourd'hui</p>
              <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#fff', fontFamily: fonts.mono }}>
                {formatFCFA(info.bilanJour.encaissements)} F
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 10, color: '#B7CFC2', fontFamily: fonts.body }}>En attente</p>
              <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#fff', fontFamily: fonts.mono }}>
                {info.demandesEnAttente}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Les quatre opérations possibles, toujours visibles. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {OPERATIONS.map((op) => (
          <button
            key={op.key}
            onClick={() => setActiveOp(op.key)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              padding: '18px 10px', borderRadius: 14, border: `1px solid ${colors.line}`,
              background: activeOp === op.key ? colors.forestPale : colors.card, cursor: 'pointer',
            }}
          >
            <op.icon size={20} color={op.tone} />
            <span style={{ fontSize: 11, fontWeight: 600, color: colors.ink, fontFamily: fonts.body, textAlign: 'center' }}>
              {op.label}
            </span>
          </button>
        ))}
      </div>

      {!loading && cloture?.cloture && (
        <Card style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, background: colors.forestPale }}>
          <CheckCircle2 size={18} color={colors.forestLight} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: colors.forest, fontFamily: fonts.body }}>
              Journée clôturée à {new Date(cloture.cloture.cloturee_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            {cloture.cloture.excedent_renvoye > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.forestLight, fontFamily: fonts.body }}>
                {formatFCFA(cloture.cloture.excedent_renvoye)} F d'excédent renvoyés vers la caisse principale.
              </p>
            )}
          </div>
        </Card>
      )}

      {!loading && !cloture?.cloture && (() => {
        const enRetard = new Date().getHours() >= 15;
        return (
          <Card
            key={reminderPulse}
            style={{
              padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14,
              background: enRetard ? colors.dangerPale : colors.card,
              border: enRetard ? `1px solid ${colors.danger}` : undefined,
              animation: enRetard ? 'cloture-pulse 1s ease-in-out' : undefined,
            }}
          >
            <Lock size={18} color={enRetard ? colors.danger : colors.muted} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: enRetard ? colors.danger : colors.ink, fontFamily: fonts.body }}>
                {enRetard ? '⏰ Clôture de la journée en attente' : 'Clôture de la journée (vers 15h30)'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                Montant de base : {formatFCFA(info?.montantBase ?? cloture?.montantBase ?? 200000)} F. Au-delà, l'excédent repart automatiquement vers la caisse principale.
              </p>
            </div>
            <button
              onClick={doCloture}
              disabled={clotureBusy}
              style={{ ...actionBtn(enRetard ? colors.danger : colors.forest, '#fff'), flexShrink: 0 }}
            >
              {clotureBusy ? 'Clôture…' : 'Clôturer la caisse'}
            </button>
            <style>{`
              @keyframes cloture-pulse {
                0% { transform: scale(1); }
                30% { transform: scale(1.015); }
                100% { transform: scale(1); }
              }
            `}</style>
          </Card>
        );
      })()}

      {activeOp && (
        <OperationForm
          type={activeOp}
          onCancel={() => setActiveOp(null)}
          onDone={closeForm}
        />
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>Historique de mes demandes</SectionTitle>
        {!loading && operations.length === 0 && (
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
                {OP_LABELS[op.type] ?? op.type}{op.client ? ` — ${op.client}` : ''}
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

function OperationForm({ type, onCancel, onDone }) {
  const needsClient = type === 'retrait_client' || type === 'encaissement_client';
  const [query, setQuery] = useState('');
  const [resultats, setResultats] = useState([]);
  const [client, setClient] = useState(null);
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ribData, setRibData] = useState(null);
  const [modePaiement, setModePaiement] = useState('especes');
  const [telephonePaiement, setTelephonePaiement] = useState('');

  useEffect(() => {
    if (!needsClient || query.trim().length < 2) {
      setResultats([]);
      return;
    }
    const timeout = setTimeout(() => {
      searchCaisseClient(query.trim()).then(setResultats).catch(() => setResultats([]));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, needsClient]);

  const imprimerRib = async () => {
    if (!client) return;
    const data = await fetchRib(client.id);
    setRibData(data);
    setTimeout(() => window.print(), 150);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (type === 'retrait_client') {
        await demanderRetraitCaisse(client.id, Number(montant), motif || undefined, modePaiement, modePaiement !== 'especes' ? telephonePaiement : undefined);
        onDone(`Demande de retrait de ${formatFCFA(Number(montant))} F déposée pour ${client.full_name} — en attente du directeur.`);
      } else if (type === 'encaissement_client') {
        await encaisserClient(client.id, Number(montant), motif || undefined);
        onDone(`${formatFCFA(Number(montant))} F encaissés et crédités sur le compte de ${client.full_name}.`);
      } else if (type === 'depense') {
        await demanderDepenseCaisse(Number(montant), motif);
        onDone(`Demande de dépense de ${formatFCFA(Number(montant))} F envoyée au directeur.`);
      } else if (type === 'appro') {
        await demanderApproCaisse(Number(montant), motif || undefined);
        onDone('Demande de réapprovisionnement envoyée au directeur.');
      }
    } catch (err) {
      setError(err.message ?? "L'opération n'a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    retrait_client: 'Payer un client au guichet',
    encaissement_client: "Recevoir un dépôt d'un client",
    depense: 'Dépense de fonctionnement',
    appro: 'Demander un réapprovisionnement',
  };

  return (
    <Card style={{ padding: 20 }}>
      <p style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        {titles[type]}
      </p>

      {needsClient && !client && (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom du client ou numéro de compte (CPG-...)"
            style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body }}
          />
          {resultats.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {resultats.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { setClient(r); setResultats([]); setQuery(''); setTelephonePaiement(r.phone ?? ''); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
                    borderRadius: 10, border: `1px solid ${colors.line}`, background: colors.bg,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>{r.full_name}</span>
                  <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{formatFCFA(r.balance)} F</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {(!needsClient || client) && (
        <form onSubmit={submit}>
          {client && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: colors.forestPale, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.forest, fontFamily: fonts.body }}>{client.full_name}</p>
                <p style={{ margin: 0, fontSize: 11, color: colors.forestLight, fontFamily: fonts.body }}>{client.client_number} · Solde : {formatFCFA(client.balance)} F</p>
              </div>
              <button type="button" onClick={() => setClient(null)} style={{ border: 'none', background: 'transparent', color: colors.forestLight, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>
                Changer
              </button>
            </div>
          )}

          {type === 'retrait_client' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Mode de paiement</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {[
                  { key: 'especes', label: 'Espèces' },
                  { key: 'airtel', label: 'Airtel Money' },
                  { key: 'moov', label: 'Moov Money' },
                ].map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setModePaiement(m.key)}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 9, fontSize: 12, fontFamily: fonts.body, cursor: 'pointer',
                      border: `1px solid ${modePaiement === m.key ? colors.forestLight : colors.line}`,
                      background: modePaiement === m.key ? colors.forestPale : colors.card,
                      color: modePaiement === m.key ? colors.forestLight : colors.muted,
                      fontWeight: modePaiement === m.key ? 600 : 400,
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {modePaiement !== 'especes' && (
                <input
                  value={telephonePaiement}
                  onChange={(e) => setTelephonePaiement(e.target.value)}
                  placeholder="Numéro qui recevra le paiement"
                  required
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.mono, marginTop: 8 }}
                />
              )}
            </div>
          )}

          <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Montant (FCFA)</label>
          <input
            type="number" min="500" required autoFocus={!needsClient}
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
            placeholder="0"
            style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, fontSize: 16, fontFamily: fonts.mono, margin: '6px 0 12px' }}
          />

          <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
            Motif {type === 'depense' ? '(obligatoire)' : '(optionnel)'}
          </label>
          <input
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            required={type === 'depense'}
            placeholder={type === 'depense' ? 'Pourquoi cette dépense ?' : ''}
            style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, margin: '6px 0 16px' }}
          />

          {error && <p style={{ fontSize: 12, color: colors.danger, marginBottom: 12, fontFamily: fonts.body }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" disabled={busy || !montant} style={actionBtn(colors.forest, '#fff')}>
              {type === 'encaissement_client' ? 'Encaisser' : 'Envoyer la demande'}
            </button>
            <button type="button" onClick={onCancel} style={actionBtn('transparent', colors.muted)}>Annuler</button>
            {type === 'retrait_client' && client && (
              <button type="button" onClick={imprimerRib} style={{ ...actionBtn(colors.card, colors.ink), border: `1px solid ${colors.line}`, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <Printer size={13} /> RIB
              </button>
            )}
          </div>
          {(type === 'retrait_client' || type === 'appro') && (
            <p style={{ margin: '10px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              Sera soumis au directeur avant tout effet réel.
            </p>
          )}
        </form>
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
    </Card>
  );
}
