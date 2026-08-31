import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, ShieldCheck, Users, Wallet, UserCog, Bell, Package, CalendarClock, Check, X,
  Gavel, KeyRound, History,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, KpiCard, SectionTitle, DataTable, td } from '../components/UI';
import {
  approveCredit, setUserStatus, fetchUsers, createUser, resetClientPin, fetchStatistics, fetchMomoTransactions,
  fetchPendingInstallmentAdjustments, decideInstallmentAdjustment,
  fetchFinalApprovalQueue, grantExceptionAuthorization, fetchExceptionAuthorizations,
  fetchDemandesCaisseEnAttente, validerOperationCaisse, rejeterOperationCaisse,
  fetchAuditLog,
} from '../api/adminApi';
import { can } from '../auth/roles';
import CatalogView from './CatalogView';
import CommissionView from './CommissionView';

export default function SupervisorView({ role }) {
  const [tab, setTab] = useState('vue');

  const tabs = [
    { key: 'vue', label: "Vue d'ensemble", icon: LayoutDashboard },
  ];
  if (can(role, 'commission.programmer')) {
    tabs.push({ key: 'commission', label: 'Commission', icon: Gavel });
  }
  if (can(role, 'demandes.approuver_final')) {
    tabs.push({ key: 'validation', label: 'Approbation finale', icon: ShieldCheck });
  }
  tabs.push(
    { key: 'catalogue', label: 'Catalogue', icon: Package },
    { key: 'utilisateurs', label: 'Utilisateurs', icon: Users },
    { key: 'momo', label: 'Mobile Money', icon: Wallet },
  );
  if (can(role, 'operations.decider_correction_echeance')) {
    tabs.push({ key: 'corrections', label: 'Corrections d\'échéances', icon: CalendarClock });
  }
  if (can(role, 'commission.autoriser_exception')) {
    tabs.push({ key: 'exceptions', label: 'Autorisations d\'exception', icon: KeyRound });
  }
  if (can(role, 'caisse.valider')) {
    tabs.push({ key: 'caisse', label: 'Validations caisse', icon: Wallet });
  }
  if (can(role, 'audit.lire')) {
    tabs.push({ key: 'audit', label: "Journal d'activité", icon: History });
  }

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={tabs}
      />
      {tab === 'vue' && <Overview />}
      {tab === 'commission' && <CommissionView />}
      {tab === 'validation' && <FinalValidation />}
      {tab === 'catalogue' && <CatalogView role={role} />}
      {tab === 'utilisateurs' && <UserManagement />}
      {tab === 'momo' && <MomoSupervision />}
      {tab === 'corrections' && <PendingAdjustments />}
      {tab === 'exceptions' && <ExceptionAuthorizations />}
      {tab === 'caisse' && <CaisseValidation />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 10,
  border: `1px solid ${colors.line}`,
  fontFamily: fonts.body,
  fontSize: 12,
};

function Overview() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatistics().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading || !stats) {
    return <Card style={{ padding: 40, textAlign: 'center' }}>Chargement…</Card>;
  }

  const { kpis: k, creditsParMois, segments } = stats;
  const kpiCards = [
    { label: 'Crédits actifs', value: String(k.credits_actifs), delta: '', up: true },
    { label: 'Encours total', value: `${formatFCFA(k.encours_total)} F`, delta: '', up: true },
    { label: 'Dossiers en attente', value: String(k.en_attente), delta: '', up: true },
    { label: 'Échéances en retard', value: String(k.echeances_en_retard), delta: '', up: k.echeances_en_retard === 0 },
  ];
  const palette = [colors.forest, colors.gold, colors.forestLight, colors.muted, colors.danger, colors.ink];
  const clientSegments = segments.map((s, i) => ({
    name: s.segment, value: Number(s.clients), color: palette[i % palette.length],
  }));
  const monthlyCredits = creditsParMois.map((m) => ({ mois: m.mois, credits: Number(m.credits) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {kpiCards.map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <Card style={{ padding: 20 }}>
          <p style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Crédits accordés par mois
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={monthlyCredits}>
              <defs>
                <linearGradient id="creditGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.forest} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={colors.forest} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.line} />
              <XAxis
                dataKey="mois"
                tick={{ fontSize: 11, fontFamily: fonts.body, fill: colors.muted }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fontFamily: fonts.body, fill: colors.muted }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="credits"
                stroke={colors.forest}
                fill="url(#creditGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card style={{ padding: 20 }}>
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Répartition des clients
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={clientSegments}
                dataKey="value"
                nameKey="name"
                innerRadius={42}
                outerRadius={68}
                paddingAngle={2}
              >
                {clientSegments.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {clientSegments.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />
                  <span style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>{s.name}</span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function FinalValidation() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const queue = await fetchFinalApprovalQueue();
      setPending(queue);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const approve = async (r) => {
    setBusy(r.id);
    try {
      await approveCredit(r.id);
      setToast(`Crédit ${r.id} approuvé — fonds débloqués, notification envoyée à ${r.client}.`);
      setPending((prev) => prev.filter((x) => x.id !== r.id));
      setTimeout(() => setToast(''), 4000);
    } catch (e) {
      setToast(e.message);
      setTimeout(() => setToast(''), 4000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {toast && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: colors.goldPale,
            border: `1px solid ${colors.gold}`,
            borderRadius: 12,
            padding: '11px 16px',
            marginBottom: 16,
            fontSize: 12,
            color: colors.goldDark,
            fontFamily: fonts.body,
          }}
        >
          <Bell size={14} /> {toast}
        </div>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>
          {loading ? 'Chargement…' : `${pending.length} dossier${pending.length > 1 ? 's' : ''} en attente d'approbation finale`}
        </SectionTitle>
        <p style={{ margin: 0, padding: '0 20px 14px', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
          Uniquement les dossiers déjà passés par le comité de crédit puis revalidés par un opérateur.
          C'est ici que les fonds sont réellement débloqués.
        </p>

        {!loading && pending.length === 0 && (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucun dossier en attente.
          </p>
        )}

        {pending.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 20,
              padding: '16px 20px',
              borderBottom: `1px solid ${colors.line}`,
              opacity: busy === r.id ? 0.5 : 1,
            }}
          >
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                {r.client}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                {r.poste} · Réf. {r.id} · double validation faite
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                {formatFCFA(r.montant)} F
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                {r.duree} mois
              </p>
            </div>
            <button onClick={() => approve(r)} disabled={busy === r.id} style={actionBtn(colors.forest, '#fff')}>
              <Check size={12} style={{ marginRight: 4 }} /> Approuver et débloquer les fonds
            </button>
          </div>
        ))}
      </Card>
    </>
  );
}

/**
 * Autorisations d'exception : réservé au directeur. Permet à un client
 * qui a déjà un crédit actif de repasser en commission pour un second
 * dossier — sans quoi le dépôt en commission serait bloqué.
 */
function ExceptionAuthorizations() {
  const [clientId, setClientId] = useState('');
  const [motif, setMotif] = useState('');
  const [granted, setGranted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const list = await fetchExceptionAuthorizations();
      setGranted(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await grantExceptionAuthorization(clientId.trim(), motif.trim());
      setToast(`Autorisation accordée pour ${clientId.trim()}.`);
      setTimeout(() => setToast(''), 5000);
      setClientId('');
      setMotif('');
      await load();
    } catch (e) {
      setError(e.message);
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

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          Accorder une autorisation d'exception
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Un client qui a déjà un crédit en cours ne peut pas être redéposé en commission pour un second
          dossier sans cette autorisation, accordée au cas par cas et consommée une seule fois.
        </p>
        {error && (
          <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{error}</p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 600, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase' }}>
              Numéro client
            </p>
            <input
              style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body, width: '100%', boxSizing: 'border-box' }}
              placeholder="ex. CPG-00931" value={clientId} onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div>
            <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 600, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase' }}>
              Motif
            </p>
            <input
              style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body, width: '100%', boxSizing: 'border-box' }}
              placeholder="Pourquoi cette exception ?" value={motif} onChange={(e) => setMotif(e.target.value)}
            />
          </div>
          <button
            onClick={submit}
            disabled={!clientId.trim() || motif.trim().length < 5 || busy}
            style={actionBtn(colors.forest, '#fff')}
          >
            Accorder
          </button>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>
          {loading ? 'Chargement…' : `${granted.length} autorisation${granted.length > 1 ? 's' : ''} non consommée${granted.length > 1 ? 's' : ''}`}
        </SectionTitle>
        {!loading && granted.length === 0 && (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucune autorisation en attente d'utilisation.
          </p>
        )}
        {granted.map((a) => (
          <div key={a.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${colors.line}` }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
              {a.client}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {a.motif} · accordée le {new Date(a.grantedAt).toLocaleDateString('fr-FR')}
            </p>
          </div>
        ))}
      </Card>
    </div>
  );
}

function CaisseValidation() {
  const [demandes, setDemandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [motifRejet, setMotifRejet] = useState('');
  const [toast, setToast] = useState('');

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 6000);
  };

  const load = () => {
    setLoading(true);
    fetchDemandesCaisseEnAttente().then(setDemandes).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const valider = async (id) => {
    setBusy(id);
    try {
      await validerOperationCaisse(id);
      flash('Opération validée — les fonds ont été débités.');
      load();
    } catch (err) {
      flash(err.message ?? 'Validation impossible.');
    } finally {
      setBusy(null);
    }
  };

  const rejeter = async (id) => {
    setBusy(id);
    try {
      await rejeterOperationCaisse(id, motifRejet);
      flash('Demande rejetée.');
      setRejectingId(null);
      setMotifRejet('');
      load();
    } catch (err) {
      flash(err.message ?? 'Rejet impossible.');
    } finally {
      setBusy(null);
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

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>
          {loading ? 'Chargement…' : `${demandes.length} demande${demandes.length > 1 ? 's' : ''} de caisse en attente`}
        </SectionTitle>

        {!loading && demandes.length === 0 && (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucune demande en attente.
          </p>
        )}

        {demandes.map((d) => (
          <div key={d.id} style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <Badge tone={d.type === 'appro' ? 'gold' : 'neutral'}>
                    {d.type === 'appro' ? 'Réapprovisionnement' : 'Retrait guichet'}
                  </Badge>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                    {d.caissier}
                  </p>
                </div>
                {d.client && (
                  <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
                    Client : {d.client} ({d.client_number})
                  </p>
                )}
                <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  {new Date(d.demandee_le).toLocaleString('fr-FR')}
                  {d.motif ? ` · ${d.motif}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.ink, fontFamily: fonts.mono }}>
                  {formatFCFA(d.montant)} F
                </p>
                <button
                  onClick={() => valider(d.id)}
                  disabled={busy === d.id}
                  style={roundBtn(colors.forestPale)}
                  title="Valider"
                >
                  <Check size={16} color={colors.forestLight} />
                </button>
                <button
                  onClick={() => setRejectingId(rejectingId === d.id ? null : d.id)}
                  disabled={busy === d.id}
                  style={roundBtn(colors.dangerPale)}
                  title="Rejeter"
                >
                  <X size={16} color={colors.danger} />
                </button>
              </div>
            </div>

            {rejectingId === d.id && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  autoFocus
                  value={motifRejet}
                  onChange={(e) => setMotifRejet(e.target.value)}
                  placeholder="Motif du rejet (obligatoire)"
                  style={{ flex: 1, padding: '9px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body }}
                />
                <button
                  onClick={() => rejeter(d.id)}
                  disabled={!motifRejet.trim() || busy === d.id}
                  style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: colors.danger, color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer' }}
                >
                  Confirmer le rejet
                </button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

const ACTION_LABELS = {
  'utilisateur.cree': 'Création de compte',
  'utilisateur.pin_client_reinitialise': 'Réinitialisation PIN client',
  'client.compte_active': 'Activation compte (client)',
  'connexion.client': 'Connexion client',
  'caisse.retrait_demande': 'Demande de retrait guichet',
  'caisse.appro_demandee': 'Demande de réapprovisionnement',
  'caisse.operation_validee': 'Opération de caisse validée',
  'caisse.operation_rejetee': 'Opération de caisse rejetée',
  'credit.valide_niveau1': 'Validation niveau 1',
  'credit.valide_double': 'Double validation',
  'credit.approuve_final': 'Approbation finale',
  'credit.rejete': 'Crédit rejeté',
  'commission.seance_programmee': 'Séance de commission programmée',
  'commission.decision': 'Décision en commission',
  'catalogue.produit_cree': 'Produit créé',
  'catalogue.taux_ajuste': 'Taux ajusté',
  'operations.echeance_corrigee': 'Correction d\'échéance',
};

function AuditLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtreActeur, setFiltreActeur] = useState('');

  useEffect(() => {
    fetchAuditLog().then(setEntries).finally(() => setLoading(false));
  }, []);

  const filtered = filtreActeur.trim()
    ? entries.filter((e) => (e.acteur ?? '').toLowerCase().includes(filtreActeur.trim().toLowerCase()))
    : entries;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <SectionTitle
        right={
          <input
            value={filtreActeur}
            onChange={(e) => setFiltreActeur(e.target.value)}
            placeholder="Filtrer par personne…"
            style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${colors.line}`, fontSize: 11, fontFamily: fonts.body }}
          />
        }
      >
        {loading ? 'Chargement…' : `${filtered.length} action${filtered.length > 1 ? 's' : ''} — 200 dernières au total`}
      </SectionTitle>

      {!loading && filtered.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucune activité correspondante.
        </p>
      )}

      {filtered.map((e) => (
        <div
          key={e.id}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '11px 20px', borderBottom: `1px solid ${colors.line}`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
              {ACTION_LABELS[e.action] ?? e.action}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {e.acteur ?? 'Système'} {e.actor_role ? `(${e.actor_role})` : ''}
            </p>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.mono, flexShrink: 0 }}>
            {new Date(e.created_at).toLocaleString('fr-FR')}
          </p>
        </div>
      ))}
    </Card>
  );
}

function UserManagement() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ nomComplet: '', telephone: '', email: '', role: 'operateur', motDePasse: '', codePin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingResetId, setConfirmingResetId] = useState(null);
  const [resetBusy, setResetBusy] = useState(null);
  const [toast, setToast] = useState('');

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 5000);
  };

  const load = () => {
    setLoading(true);
    fetchUsers().then(setList).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggle = async (u) => {
    const next = u.status === 'actif' ? 'suspendu' : 'actif';
    await setUserStatus(u.id, next);
    setList((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: next } : x)));
  };

  const doResetPin = async (u) => {
    setResetBusy(u.id);
    try {
      await resetClientPin(u.id);
      setConfirmingResetId(null);
      flash(`Code PIN de ${u.full_name} réinitialisé — le client peut en recréer un avec son numéro client (${u.client_number}).`);
    } catch (err) {
      flash(err.message ?? 'Réinitialisation impossible.');
    } finally {
      setResetBusy(null);
    }
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Filet de sécurité : n'envoie que les champs pertinents pour
      // le rôle choisi, même si le formulaire garde en mémoire une
      // ancienne valeur (remplissage automatique du navigateur, ou
      // changement de rôle en cours de saisie) — un client ne doit
      // jamais se voir attribuer un email ou un mot de passe resté
      // d'un essai précédent avec un autre rôle.
      const payload = form.role === 'client'
        ? { nomComplet: form.nomComplet, telephone: form.telephone, role: form.role, codePin: form.codePin }
        : { nomComplet: form.nomComplet, telephone: form.telephone, role: form.role, email: form.email, motDePasse: form.motDePasse };

      const cree = await createUser(payload);
      setCreating(false);
      setForm({ nomComplet: '', telephone: '', email: '', role: 'operateur', motDePasse: '', codePin: '' });
      load();
      if (payload.role === 'client') {
        flash(`Compte créé — numéro client ${cree.client_number}. Communiquez-le au client pour qu'il active son PIN dans l'app.`);
      }
    } catch (err) {
      setError(err.message ?? 'Création impossible.');
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

      {creating && (
        <Card style={{ padding: 18, marginBottom: 16 }}>
          <form onSubmit={submitCreate}>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
              Nouvel utilisateur
            </p>
            {error && <p style={{ fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{error}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <input placeholder="Nom complet" required value={form.nomComplet}
                onChange={(e) => setForm((f) => ({ ...f, nomComplet: e.target.value }))}
                style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body }} />
              <input placeholder="Téléphone" required value={form.telephone}
                onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
                style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body }} />
              <select value={form.role} onChange={(e) => {
                const role = e.target.value;
                setForm((f) => ({
                  ...f, role,
                  ...(role === 'client' ? { email: '', motDePasse: '' } : { codePin: '' }),
                }));
              }}
                style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body }}>
                <option value="client">Client</option>
                <option value="operateur">Opérateur</option>
                <option value="superviseur">Gestionnaire / Superviseur</option>
              </select>
              {form.role === 'client' ? (
                <input placeholder="Code PIN (optionnel — laissez vide pour que le client l'active lui-même)" value={form.codePin}
                  onChange={(e) => setForm((f) => ({ ...f, codePin: e.target.value }))}
                  style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body }} />
              ) : (
                <>
                  <input placeholder="Email" type="email" value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body }} />
                  <input placeholder="Mot de passe (12+ caractères)" type="password" value={form.motDePasse}
                    onChange={(e) => setForm((f) => ({ ...f, motDePasse: e.target.value }))}
                    style={{ padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body }} />
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={busy} style={actionBtn(colors.forest, '#fff')}>
                {busy ? 'Création…' : 'Créer'}
              </button>
              <button type="button" onClick={() => setCreating(false)} style={actionBtn('transparent', colors.muted)}>
                Annuler
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle
          right={
            <button
              onClick={() => setCreating(true)}
              style={{
                border: 'none', background: 'transparent', color: colors.forestLight,
                fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer',
              }}
            >
              + Ajouter un utilisateur
            </button>
          }
        >
          {loading ? 'Chargement…' : 'Employés et clients'}
        </SectionTitle>

        <DataTable
          columns={['Nom', 'Numéro client', 'Rôle', 'Type', 'Statut', '']}
          rows={list}
          renderCell={(u) => (
            <>
              <td style={{ ...td, fontWeight: 500 }}>{u.full_name}</td>
              <td style={{ ...td, color: colors.muted, fontFamily: fonts.mono }}>{u.client_number ?? '—'}</td>
              <td style={{ ...td, color: colors.muted }}>{u.role}</td>
              <td style={td}>
                <Badge>{u.role === 'client' ? 'Client' : 'Employé'}</Badge>
              </td>
              <td style={td}>
                <Badge tone={u.status === 'suspendu' ? 'danger' : 'neutral'}>
                  {u.status === 'actif' ? 'Actif' : u.status === 'suspendu' ? 'Suspendu' : 'Fermé'}
                </Badge>
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {u.role === 'client' && (
                    confirmingResetId === u.id ? (
                      <>
                        <span style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Confirmer ?</span>
                        <button
                          onClick={() => doResetPin(u)}
                          disabled={resetBusy === u.id}
                          style={{ ...actionBtn(colors.danger, '#fff'), padding: '5px 10px' }}
                        >
                          Oui
                        </button>
                        <button
                          onClick={() => setConfirmingResetId(null)}
                          style={{ border: 'none', background: 'transparent', color: colors.muted, fontSize: 11, cursor: 'pointer', fontFamily: fonts.body }}
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmingResetId(u.id)}
                        title="Réinitialiser le code PIN du client"
                        style={{ border: 'none', background: 'transparent', color: colors.forestLight, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}
                      >
                        Réinitialiser le PIN
                      </button>
                    )
                  )}
                  <button
                    onClick={() => toggle(u)}
                    title={u.status === 'actif' ? 'Suspendre' : 'Réactiver'}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                  >
                    <UserCog size={15} color={colors.muted} />
                  </button>
                </div>
              </td>
            </>
          )}
        />
      </Card>
    </div>
  );
}

function MomoSupervision() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMomoTransactions().then(setTransactions).finally(() => setLoading(false));
  }, []);

  const tone = (s) => (s === 'echouee' ? 'danger' : s === 'en_attente' || s === 'initiee' ? 'gold' : 'neutral');
  const label = (s) => ({
    initiee: 'Initiée', en_attente: 'En attente', confirmee: 'Confirmée', echouee: 'Échouée', annulee: 'Annulée',
  }[s] ?? s);

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <SectionTitle>{loading ? 'Chargement…' : 'Supervision des transactions Mobile Money'}</SectionTitle>
      <DataTable
        columns={['Référence', 'Client', 'Opérateur', 'Sens', 'Montant', 'Statut']}
        rows={transactions}
        renderCell={(t) => (
          <>
            <td style={{ ...td, fontFamily: fonts.mono, color: colors.muted }}>{t.reference}</td>
            <td style={{ ...td, fontWeight: 500 }}>{t.client}</td>
            <td style={{ ...td, color: colors.muted }}>{t.operator === 'airtel' ? 'Airtel Money' : 'Moov Money'}</td>
            <td style={{ ...td, color: colors.muted }}>{t.direction === 'entrant' ? 'Entrant' : 'Sortant'}</td>
            <td style={{ ...td, fontFamily: fonts.mono, fontWeight: 600 }}>{formatFCFA(t.amount)} F</td>
            <td style={td}>
              <Badge tone={tone(t.status)}>{label(t.status)}</Badge>
            </td>
          </>
        )}
      />
    </Card>
  );
}

const actionBtn = (bg, fg) => ({
  padding: '8px 14px',
  borderRadius: 10,
  border: 'none',
  background: bg,
  color: fg,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: fonts.body,
  cursor: 'pointer',
});

const roundBtn = (bg, size = 32) => ({
  width: size,
  height: size,
  borderRadius: size / 2,
  border: 'none',
  background: bg,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
});

/**
 * Corrections d'échéance proposées par l'opérateur, en attente de la
 * validation du directeur — « l'opérateur peut corriger l'échéance
 * mais toujours avec une validation du directeur pour ce genre
 * d'opération. » Rien ne s'applique tant que ce n'est pas décidé ici.
 */
function PendingAdjustments() {
  const [demandes, setDemandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchPendingInstallmentAdjustments();
      setDemandes(r);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 6000);
  };

  const decide = async (demande, approuver) => {
    if (!approuver && note.trim().length === 0) return;
    setBusyId(demande.id);
    try {
      await decideInstallmentAdjustment(demande.id, approuver, note.trim());
      setDemandes((prev) => prev.filter((d) => d.id !== demande.id));
      setRejectingId(null);
      setNote('');
      flash(
        approuver
          ? `Correction approuvée : échéance n°${demande.sequence} de ${demande.creditReference} déplacée au ${new Date(demande.nouvelleDate).toLocaleDateString('fr-FR')}.`
          : `Correction rejetée pour l'échéance n°${demande.sequence} de ${demande.creditReference}.`
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {toast && (
        <div style={{
          margin: 16, background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 12,
          padding: '11px 16px', fontSize: 12, color: colors.goldDark, fontFamily: fonts.body,
        }}>
          {toast}
        </div>
      )}

      <SectionTitle>
        {loading ? 'Chargement…' : `${demandes.length} demande${demandes.length > 1 ? 's' : ''} en attente`}
      </SectionTitle>

      {!loading && demandes.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucune correction d'échéance en attente de validation.
        </p>
      )}

      {demandes.map((d) => (
        <div key={d.id} style={{ borderBottom: `1px solid ${colors.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 20px', opacity: busyId === d.id ? 0.5 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                {d.creditReference} · Échéance n°{d.sequence}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                Proposé par {d.demandeur} · {d.motif}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.body, textDecoration: 'line-through' }}>
                {new Date(d.dateActuelle).toLocaleDateString('fr-FR')}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: colors.forestLight, fontFamily: fonts.mono }}>
                → {new Date(d.nouvelleDate).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => decide(d, true)} disabled={busyId === d.id} style={actionBtn(colors.forest, '#fff')}>
                <Check size={12} style={{ marginRight: 4 }} /> Approuver
              </button>
              <button
                onClick={() => setRejectingId(rejectingId === d.id ? null : d.id)}
                disabled={busyId === d.id}
                style={actionBtn(colors.dangerPale, colors.danger)}
              >
                <X size={12} style={{ marginRight: 4 }} /> Rejeter
              </button>
            </div>
          </div>

          {rejectingId === d.id && (
            <div style={{ padding: '0 20px 16px', display: 'flex', gap: 8 }}>
              <input
                placeholder="Motif du rejet (obligatoire)"
                value={note} onChange={(e) => setNote(e.target.value)}
                style={{
                  flex: 1, padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`,
                  fontSize: 12, fontFamily: fonts.body, outline: 'none',
                }}
              />
              <button
                onClick={() => decide(d, false)}
                disabled={note.trim().length === 0 || busyId === d.id}
                style={{ ...actionBtn(colors.danger, '#fff'), opacity: note.trim().length === 0 ? 0.5 : 1 }}
              >
                Confirmer le rejet
              </button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
