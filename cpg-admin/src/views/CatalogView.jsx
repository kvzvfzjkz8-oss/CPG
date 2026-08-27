import React, { useState, useEffect } from 'react';
import {
  Package, Percent, GitPullRequest, ShieldAlert, Plus, Play, Pause, Check, X,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, SectionTitle, DataTable, td } from '../components/UI';
import { can } from '../auth/roles';
import {
  fetchProducts, createProduct, adjustProductRate, setProductStatus,
  fetchFees, createFee, adjustFeeRate, setFeeStatus, runAgiosBatch,
  fetchChangeRequests, decideChangeRequest, fetchCeilings, updateCeiling,
} from '../api/adminApi';

const pct = (n) => `${(Number(n) * 100).toFixed(2).replace('.', ',')} %`;

const actionBtn = (bg, fg) => ({
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '7px 12px', borderRadius: 9, border: 'none',
  background: bg, color: fg, fontSize: 11, fontWeight: 600,
  fontFamily: fonts.body, cursor: 'pointer', whiteSpace: 'nowrap',
});

const input = {
  padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`,
  fontSize: 12, fontFamily: fonts.body, outline: 'none', width: '100%',
  boxSizing: 'border-box',
};

const label = {
  display: 'block', fontSize: 10, fontWeight: 600, color: colors.muted,
  fontFamily: fonts.body, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4,
};

function Toast({ text }) {
  if (!text) return null;
  return (
    <div
      style={{
        background: colors.goldPale, border: `1px solid ${colors.gold}`,
        borderRadius: 12, padding: '11px 16px', marginBottom: 16,
        fontSize: 12, color: colors.goldDark, fontFamily: fonts.body,
      }}
    >
      {text}
    </div>
  );
}

function Field({ children, span }) {
  return <div style={{ gridColumn: span ? `span ${span}` : undefined }}>{children}</div>;
}

export default function CatalogView({ role }) {
  const [tab, setTab] = useState('produits');

  const tabs = [
    { key: 'produits', label: 'Produits', icon: Package },
    { key: 'services', label: 'Services & agios', icon: Percent },
    { key: 'changements', label: 'Demandes de changement', icon: GitPullRequest },
  ];
  if (can(role, 'plafonds.gerer')) {
    tabs.push({ key: 'plafonds', label: 'Plafonds', icon: ShieldAlert });
  }

  return (
    <div>
      <Tabs value={tab} onChange={setTab} options={tabs} />
      {tab === 'produits' && <ProductsPanel role={role} />}
      {tab === 'services' && <ServicesPanel role={role} />}
      {tab === 'changements' && <ChangeRequestsPanel role={role} />}
      {tab === 'plafonds' && can(role, 'plafonds.gerer') && <CeilingsPanel />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PRODUITS DE CRÉDIT
   ═══════════════════════════════════════════════════════════════════ */

function ProductsPanel({ role }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [adjusting, setAdjusting] = useState(null); // id du produit en cours d'ajustement
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetchProducts().then(setProducts).finally(() => setLoading(false));
  }, []);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 5000);
  };

  const handleCreate = async (form) => {
    setBusy('create');
    try {
      const result = await createProduct(form);
      setProducts((prev) => [
        {
          id: `local-${Date.now()}`, code: form.code, name: form.nom,
          description: form.description, status: 'brouillon', version: 1,
          monthly_rate: form.bareme.monthlyRate, min_amount: form.bareme.minAmount,
          max_amount: form.bareme.maxAmount, min_duration: form.bareme.minDuration,
          max_duration: form.bareme.maxDuration,
        },
        ...prev,
      ]);
      setCreating(false);
      flash(result?.message ?? 'Produit créé en brouillon. Il doit être activé par le directeur.');
    } finally {
      setBusy(null);
    }
  };

  const handleAdjust = async (product, form) => {
    setBusy(product.id);
    try {
      const result = await adjustProductRate(product.id, form);
      if (result.statut === 'applique') {
        setProducts((prev) =>
          prev.map((p) => (p.id === product.id ? { ...p, ...toProductFields(form.bareme) } : p))
        );
        flash(`Nouveau barème appliqué sur ${product.code}.`);
      } else {
        flash(`Changement hors marge envoyé au directeur pour ${product.code} : rien n'est appliqué avant sa décision.`);
      }
      setAdjusting(null);
    } finally {
      setBusy(null);
    }
  };

  const toggleStatus = async (product) => {
    const next = product.status === 'actif' ? 'suspendu' : 'actif';
    setBusy(product.id);
    try {
      await setProductStatus(product.id, next);
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, status: next } : p)));
      flash(
        next === 'actif'
          ? `${product.code} est désormais proposé aux clients.`
          : `${product.code} suspendu : n'apparaît plus dans le catalogue client.`
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <Toast text={toast} />

      {can(role, 'catalogue.creer') && (
        <div style={{ marginBottom: 16 }}>
          {!creating ? (
            <button onClick={() => setCreating(true)} style={actionBtn(colors.forest, '#fff')}>
              <Plus size={13} /> Nouveau produit
            </button>
          ) : (
            <ProductForm
              busy={busy === 'create'}
              onCancel={() => setCreating(false)}
              onSubmit={handleCreate}
            />
          )}
        </div>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>
          {loading ? 'Chargement…' : `${products.length} produit${products.length > 1 ? 's' : ''} au catalogue`}
        </SectionTitle>

        {products.map((p) => (
          <div key={p.id} style={{ borderBottom: `1px solid ${colors.line}` }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 16, padding: '14px 20px', opacity: busy === p.id ? 0.5 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
                    {p.name}
                  </span>
                  <Badge tone={p.status === 'actif' ? 'neutral' : p.status === 'brouillon' ? 'gold' : 'danger'}>
                    {p.status === 'actif' ? 'Actif' : p.status === 'brouillon' ? 'Brouillon' : p.status === 'suspendu' ? 'Suspendu' : 'Archivé'}
                  </Badge>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  {p.code} · v{p.version} · {p.description}
                </p>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                  {pct(p.monthly_rate)}/mois
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  {formatFCFA(p.min_amount)} – {formatFCFA(p.max_amount)} F · {p.min_duration}–{p.max_duration} mois
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {can(role, 'catalogue.ajuster_dans_marge') && (
                  <button
                    onClick={() => setAdjusting(adjusting === p.id ? null : p.id)}
                    style={actionBtn(colors.forestPale, colors.forestLight)}
                  >
                    Ajuster le taux
                  </button>
                )}
                {can(role, 'catalogue.activer') && p.status !== 'archive' && (
                  <button
                    onClick={() => toggleStatus(p)}
                    disabled={busy === p.id}
                    style={actionBtn(
                      p.status === 'actif' ? colors.dangerPale : colors.gold,
                      p.status === 'actif' ? colors.danger : colors.forest
                    )}
                  >
                    {p.status === 'actif' ? <Pause size={12} /> : <Play size={12} />}
                    {p.status === 'actif' ? 'Suspendre' : 'Activer'}
                  </button>
                )}
              </div>
            </div>

            {adjusting === p.id && (
              <div style={{ padding: '0 20px 18px' }}>
                <RateAdjustForm
                  current={p}
                  busy={busy === p.id}
                  onCancel={() => setAdjusting(null)}
                  onSubmit={(form) => handleAdjust(p, form)}
                />
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

function toProductFields(bareme) {
  return {
    monthly_rate: bareme.monthlyRate, min_amount: bareme.minAmount, max_amount: bareme.maxAmount,
    min_duration: bareme.minDuration, max_duration: bareme.maxDuration,
  };
}

function ProductForm({ onSubmit, onCancel, busy }) {
  const [form, setForm] = useState({
    code: '', nom: '', description: '',
    monthlyRate: '', minAmount: '', maxAmount: '', minDuration: '', maxDuration: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    onSubmit({
      code: form.code.toUpperCase(), nom: form.nom, description: form.description,
      bareme: {
        monthlyRate: Number(form.monthlyRate) / 100,
        minAmount: Number(form.minAmount), maxAmount: Number(form.maxAmount),
        minDuration: Number(form.minDuration), maxDuration: Number(form.maxDuration),
      },
    });
  };

  return (
    <Card style={{ padding: 18, marginBottom: 4 }}>
      <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        Nouveau produit de crédit
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Field span={1}>
          <label style={label}>Code</label>
          <input style={input} placeholder="MICRO_XYZ" value={form.code} onChange={set('code')} />
        </Field>
        <Field span={2}>
          <label style={label}>Nom</label>
          <input style={input} value={form.nom} onChange={set('nom')} />
        </Field>
        <Field span={3}>
          <label style={label}>Description</label>
          <input style={input} value={form.description} onChange={set('description')} />
        </Field>
        <Field>
          <label style={label}>Taux mensuel (%)</label>
          <input style={input} type="number" step="0.01" value={form.monthlyRate} onChange={set('monthlyRate')} />
        </Field>
        <Field>
          <label style={label}>Montant min (FCFA)</label>
          <input style={input} type="number" value={form.minAmount} onChange={set('minAmount')} />
        </Field>
        <Field>
          <label style={label}>Montant max (FCFA)</label>
          <input style={input} type="number" value={form.maxAmount} onChange={set('maxAmount')} />
        </Field>
        <Field>
          <label style={label}>Durée min (mois)</label>
          <input style={input} type="number" value={form.minDuration} onChange={set('minDuration')} />
        </Field>
        <Field>
          <label style={label}>Durée max (mois)</label>
          <input style={input} type="number" value={form.maxDuration} onChange={set('maxDuration')} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={submit} disabled={busy} style={actionBtn(colors.forest, '#fff')}>
          Créer en brouillon
        </button>
        <button onClick={onCancel} style={actionBtn('transparent', colors.muted)}>
          Annuler
        </button>
      </div>
    </Card>
  );
}

function RateAdjustForm({ current, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState({
    monthlyRate: (current.monthly_rate * 100).toFixed(2),
    minAmount: current.min_amount, maxAmount: current.max_amount,
    minDuration: current.min_duration, maxDuration: current.max_duration,
    motif: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    onSubmit({
      motif: form.motif,
      bareme: {
        monthlyRate: Number(form.monthlyRate) / 100,
        minAmount: Number(form.minAmount), maxAmount: Number(form.maxAmount),
        minDuration: Number(form.minDuration), maxDuration: Number(form.maxDuration),
      },
    });
  };

  return (
    <Card style={{ padding: 16, background: colors.bg }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Field>
          <label style={label}>Nouveau taux (%)</label>
          <input style={input} type="number" step="0.01" value={form.monthlyRate} onChange={set('monthlyRate')} />
        </Field>
        <Field>
          <label style={label}>Montant min</label>
          <input style={input} type="number" value={form.minAmount} onChange={set('minAmount')} />
        </Field>
        <Field>
          <label style={label}>Montant max</label>
          <input style={input} type="number" value={form.maxAmount} onChange={set('maxAmount')} />
        </Field>
        <Field>
          <label style={label}>Durée max (mois)</label>
          <input style={input} type="number" value={form.maxDuration} onChange={set('maxDuration')} />
        </Field>
        <Field span={4}>
          <label style={label}>Motif (obligatoire)</label>
          <input
            style={input} value={form.motif} onChange={set('motif')}
            placeholder="Pourquoi ce changement ?"
          />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={submit}
          disabled={busy || form.motif.trim().length < 5}
          style={actionBtn(colors.forest, '#fff')}
        >
          Appliquer
        </button>
        <button onClick={onCancel} style={actionBtn('transparent', colors.muted)}>
          Annuler
        </button>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 10, color: colors.muted, fontFamily: fonts.body }}>
        Dans la marge déléguée (±20 % du taux actuel), le nouveau barème s'applique tout de suite.
        Au-delà, il part en attente de l'arbitrage du directeur.
      </p>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SERVICES ANNEXES ET AGIOS
   ═══════════════════════════════════════════════════════════════════ */

function ServicesPanel({ role }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');
  const [range, setRange] = useState({ debut: '', fin: '' });

  useEffect(() => {
    fetchFees().then(setItems).finally(() => setLoading(false));
  }, []);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 5000);
  };

  const toggleStatus = async (fee) => {
    const next = fee.status === 'actif' ? 'suspendu' : 'actif';
    setBusy(fee.id);
    try {
      await setFeeStatus(fee.id, next);
      setItems((prev) => prev.map((f) => (f.id === fee.id ? { ...f, status: next } : f)));
      flash(`${fee.code} ${next === 'actif' ? 'activé' : 'suspendu'}.`);
    } finally {
      setBusy(null);
    }
  };

  const runBatch = async () => {
    if (!range.debut || !range.fin) return;
    setBusy('batch');
    try {
      const result = await runAgiosBatch(range.debut, range.fin);
      flash(`Agios prélevés sur ${result.applied ?? 0} compte(s), total ${formatFCFA(result.total ?? 0)} F.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <Toast text={toast} />

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionTitle>
          {loading ? 'Chargement…' : `${items.length} service${items.length > 1 ? 's' : ''} annexe${items.length > 1 ? 's' : ''}`}
        </SectionTitle>
        <DataTable
          columns={['Service', 'Statut', 'Base', 'Déclencheur', 'Barème', '']}
          rows={items}
          renderCell={(f) => (
            <>
              <td style={{ ...td, fontWeight: 500 }}>
                {f.name}
                <div style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{f.code}</div>
              </td>
              <td style={td}>
                <Badge tone={f.status === 'actif' ? 'neutral' : 'gold'}>
                  {f.status === 'actif' ? 'Actif' : 'Brouillon'}
                </Badge>
              </td>
              <td style={{ ...td, color: colors.muted }}>{f.basis === 'taux' ? 'Taux' : 'Montant fixe'}</td>
              <td style={{ ...td, color: colors.muted }}>{f.trigger_on}</td>
              <td style={{ ...td, fontFamily: fonts.mono }}>
                {f.basis === 'taux' ? pct(f.rate) : `${formatFCFA(f.amount)} F`}
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                {can(role, 'catalogue.activer') && (
                  <button
                    onClick={() => toggleStatus(f)}
                    disabled={busy === f.id}
                    style={actionBtn(f.status === 'actif' ? colors.dangerPale : colors.gold, f.status === 'actif' ? colors.danger : colors.forest)}
                  >
                    {f.status === 'actif' ? 'Suspendre' : 'Activer'}
                  </button>
                )}
              </td>
            </>
          )}
        />
      </Card>

      {can(role, 'frais.appliquer') && (
        <Card style={{ padding: 18 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Prélèvement des agios
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <Field>
              <label style={label}>Début de période</label>
              <input
                style={input} type="date"
                value={range.debut} onChange={(e) => setRange((r) => ({ ...r, debut: e.target.value }))}
              />
            </Field>
            <Field>
              <label style={label}>Fin de période</label>
              <input
                style={input} type="date"
                value={range.fin} onChange={(e) => setRange((r) => ({ ...r, fin: e.target.value }))}
              />
            </Field>
            <button
              onClick={runBatch}
              disabled={busy === 'batch' || !range.debut || !range.fin}
              style={actionBtn(colors.forest, '#fff')}
            >
              <Play size={12} /> Exécuter
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DEMANDES DE CHANGEMENT DE BARÈME
   ═══════════════════════════════════════════════════════════════════ */

function ChangeRequestsPanel({ role }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetchChangeRequests().then(setItems).finally(() => setLoading(false));
  }, []);

  const decide = async (request, approve) => {
    setBusy(request.id);
    try {
      await decideChangeRequest(request.id, approve);
      setItems((prev) => prev.filter((r) => r.id !== request.id));
      setToast(
        approve
          ? `Barème approuvé pour ${request.cible} : le changement est maintenant appliqué.`
          : `Proposition rejetée pour ${request.cible}.`
      );
      setTimeout(() => setToast(''), 5000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <Toast text={toast} />
      <SectionTitle>
        {loading ? 'Chargement…' : `${items.length} demande${items.length > 1 ? 's' : ''} en attente d'arbitrage`}
      </SectionTitle>

      {items.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucune demande en attente.
        </p>
      )}

      {items.map((r) => (
        <div
          key={r.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
            padding: '16px 20px', borderBottom: `1px solid ${colors.line}`,
            opacity: busy === r.id ? 0.5 : 1,
          }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
              {r.cible}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              Proposé par {r.demandeur} · {r.reason}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
              {r.payload?.monthlyRate != null ? `${pct(r.payload.monthlyRate)}/mois` : '—'}
            </p>
          </div>
          {can(role, 'catalogue.decider_changement') ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => decide(r, true)} disabled={busy === r.id} style={actionBtn(colors.forest, '#fff')}>
                <Check size={12} /> Approuver
              </button>
              <button onClick={() => decide(r, false)} disabled={busy === r.id} style={actionBtn(colors.dangerPale, colors.danger)}>
                <X size={12} /> Rejeter
              </button>
            </div>
          ) : (
            <Badge tone="gold">En attente du directeur</Badge>
          )}
        </div>
      ))}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PLAFONDS RÉGLEMENTAIRES — directeur uniquement
   ═══════════════════════════════════════════════════════════════════ */

function CeilingsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetchCeilings().then(setItems).finally(() => setLoading(false));
  }, []);

  const startEdit = (c) => {
    setEditing(c.scope);
    setValue((c.max_rate * 100).toFixed(3));
  };

  const save = async (c) => {
    setBusy(c.scope);
    try {
      await updateCeiling(c.scope, Number(value) / 100);
      setItems((prev) =>
        prev.map((x) => (x.scope === c.scope ? { ...x, max_rate: Number(value) / 100 } : x))
      );
      setEditing(null);
      setToast(`Plafond « ${c.scope} » mis à jour. Aucun barème existant n'est modifié rétroactivement.`);
      setTimeout(() => setToast(''), 5000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <Toast text={toast} />
      <SectionTitle>{loading ? 'Chargement…' : 'Plafonds réglementaires'}</SectionTitle>
      <p style={{ margin: 0, padding: '14px 20px 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
        Garde-fou contre l'erreur de saisie : personne, pas même vous, ne peut créer ou activer
        un barème au-delà de ces valeurs.
      </p>

      {items.map((c) => (
        <div
          key={c.scope}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            padding: '16px 20px', borderTop: `1px solid ${colors.line}`, marginTop: 14,
          }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
              {c.scope}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {c.note}
            </p>
          </div>

          {editing === c.scope ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                style={{ ...input, width: 90 }} type="number" step="0.001"
                value={value} onChange={(e) => setValue(e.target.value)}
              />
              <span style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>%</span>
              <button onClick={() => save(c)} disabled={busy === c.scope} style={actionBtn(colors.forest, '#fff')}>
                Enregistrer
              </button>
              <button onClick={() => setEditing(null)} style={actionBtn('transparent', colors.muted)}>
                Annuler
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                {pct(c.max_rate)}
              </span>
              <button onClick={() => startEdit(c)} style={actionBtn(colors.forestPale, colors.forestLight)}>
                Modifier
              </button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
