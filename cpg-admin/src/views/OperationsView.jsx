import React, { useState } from 'react';
import {
  Upload, ShieldCheck, CalendarClock, FileWarning, Check, X, Undo2, Search, Pencil, Clock,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, SectionTitle } from '../components/UI';
import {
  previewSalaryImport, confirmSalaryImport, fetchMonthlyReport, fetchTransactions,
  reverseLedgerTransaction, fetchInstallmentsByReference, proposeInstallmentAdjustment,
  fetchSchedulerStatus,
} from '../api/adminApi';

const input = {
  padding: '9px 11px', borderRadius: 9, border: `1px solid ${colors.line}`,
  fontSize: 12, fontFamily: fonts.body, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const label = {
  display: 'block', fontSize: 10, fontWeight: 600, color: colors.muted,
  fontFamily: fonts.body, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4,
};
const actionBtn = (bg, fg) => ({
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 9, border: 'none',
  background: bg, color: fg, fontSize: 12, fontWeight: 600,
  fontFamily: fonts.body, cursor: 'pointer', whiteSpace: 'nowrap',
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function pct(n) {
  return `${formatFCFA(n)} F`;
}
const TYPE_LABELS = {
  salaire: 'Salaire', paiement_credit: 'Échéance crédit', deblocage_credit: 'Déblocage crédit',
  frais: 'Agios / frais', depot: 'Dépôt', retrait: 'Retrait', ajustement: 'Ajustement', annulation: 'Annulation',
};

export default function OperationsView() {
  const [tab, setTab] = useState('paie');

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: 'paie', label: 'Paie des agents', icon: Upload },
          { key: 'verification', label: 'Vérification', icon: ShieldCheck },
          { key: 'echeances', label: 'Corriger une échéance', icon: CalendarClock },
        ]}
      />
      {tab === 'paie' && <PayrollImport />}
      {tab === 'verification' && <Verification />}
      {tab === 'echeances' && <InstallmentCorrection />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PAIE DES AGENTS — import en deux temps
   ═══════════════════════════════════════════════════════════════════ */

function PayrollImport() {
  const [step, setStep] = useState('form'); // form | apercu | confirme
  const [employeur, setEmployeur] = useState('SETRAG');
  const [periode, setPeriode] = useState(new Date().toISOString().slice(0, 7));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canPreview = file && employeur.trim().length >= 2 && /^\d{4}-\d{2}$/.test(periode);

  const handlePreview = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await previewSalaryImport(file, employeur, periode);
      setPreview(result);
      setStep('apercu');
    } catch (e) {
      setError(e.message ?? "Impossible de lire le fichier.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await confirmSalaryImport(
        employeur, periode,
        preview.aCrediter.map(({ identifiant, montant }) => ({ identifiant, montant }))
      );
      setConfirmation(result);
      setStep('confirme');
    } catch (e) {
      setError(e.message ?? "Le crédit a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('form');
    setFile(null);
    setPreview(null);
    setConfirmation(null);
    setError('');
  };

  return (
    <div>
      {error && (
        <div style={{
          background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.danger, fontFamily: fonts.body,
        }}>
          {error}
        </div>
      )}

      {step === 'form' && (
        <Card style={{ padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Créditer la paie des agents
          </p>
          <p style={{ margin: '0 0 18px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
            Joignez le fichier reçu de l'employeur (deux colonnes : identifiant, montant — téléphone,
            numéro client ou nom complet). Rien n'est crédité tant que vous n'avez pas confirmé l'aperçu.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={label}>Employeur</label>
              <input style={input} value={employeur} onChange={(e) => setEmployeur(e.target.value)} />
            </div>
            <div>
              <label style={label}>Période</label>
              <input style={input} type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} />
            </div>
          </div>

          <label style={label}>Fichier de paie (CSV)</label>
          <div
            style={{
              border: `1.5px dashed ${file ? colors.forest : colors.line}`,
              borderRadius: 12, padding: '22px 16px', textAlign: 'center',
              background: file ? colors.forestPale : colors.bg, marginBottom: 18,
            }}
          >
            <input
              type="file" accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              id="payroll-file" style={{ display: 'none' }}
            />
            <label htmlFor="payroll-file" style={{ cursor: 'pointer' }}>
              <Upload size={18} color={file ? colors.forestLight : colors.muted} style={{ marginBottom: 6 }} />
              <p style={{ margin: 0, fontSize: 12, fontFamily: fonts.body, color: file ? colors.forestLight : colors.muted, fontWeight: file ? 600 : 400 }}>
                {file ? file.name : 'Cliquez pour choisir un fichier, ou glissez-le ici'}
              </p>
            </label>
          </div>

          <button
            onClick={handlePreview}
            disabled={!canPreview || busy}
            style={{ ...actionBtn(colors.forest, '#fff'), opacity: canPreview ? 1 : 0.5 }}
          >
            <Search size={13} /> {busy ? 'Lecture du fichier…' : "Voir l'aperçu"}
          </button>
        </Card>
      )}

      {step === 'apercu' && preview && (
        <PreviewStep
          preview={preview} employeur={employeur} periode={periode}
          busy={busy} onConfirm={handleConfirm} onCancel={reset}
        />
      )}

      {step === 'confirme' && confirmation && (
        <ConfirmedStep confirmation={confirmation} onRestart={reset} />
      )}
    </div>
  );
}

function PreviewStep({ preview, employeur, periode, busy, onConfirm, onCancel }) {
  const rien = preview.aCrediter.length === 0;

  return (
    <div>
      <div style={{
        background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 12,
        padding: '12px 16px', marginBottom: 16, fontSize: 12, color: colors.goldDark, fontFamily: fonts.body,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <FileWarning size={15} />
        Aperçu seulement — rien n'a encore été crédité. Vérifiez la liste avant de confirmer.
      </div>

      <Card style={{ padding: 18, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          {employeur} · {periode}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Référence du lot : <span style={{ fontFamily: fonts.mono }}>{preview.reference}</span>
        </p>
      </Card>

      {preview.aCrediter.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <SectionTitle>
            {preview.aCrediter.length} agent{preview.aCrediter.length > 1 ? 's' : ''} à créditer ·
            {' '}{pct(preview.total)}
          </SectionTitle>
          {preview.aCrediter.map((l, i) => (
            <div
              key={i}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '11px 20px', borderBottom: `1px solid ${colors.line}`,
              }}
            >
              <div>
                <span style={{ fontSize: 12, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>{l.nom}</span>
                <span style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body, marginLeft: 8 }}>{l.identifiant}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.forestLight, fontFamily: fonts.mono }}>
                +{formatFCFA(l.montant)} F
              </span>
            </div>
          ))}
        </Card>
      )}

      {preview.notFound.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <SectionTitle>{preview.notFound.length} ligne(s) écartée(s)</SectionTitle>
          {preview.notFound.map((n, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', borderBottom: `1px solid ${colors.line}` }}>
              <span style={{ fontSize: 12, color: colors.ink, fontFamily: fonts.body }}>{n.identifiant}</span>
              <Badge tone="danger">{motifLabel(n.motif)}</Badge>
            </div>
          ))}
        </Card>
      )}

      {preview.lignesInvalides?.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <SectionTitle>{preview.lignesInvalides.length} ligne(s) mal formée(s) dans le fichier</SectionTitle>
          {preview.lignesInvalides.map((e, i) => (
            <div key={i} style={{ padding: '10px 20px', borderBottom: `1px solid ${colors.line}`, fontSize: 11, fontFamily: fonts.mono, color: colors.muted }}>
              Ligne {e.ligne} : « {e.contenu} » — {motifLabel(e.motif)}
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} style={actionBtn('transparent', colors.muted)}>
          Annuler et recommencer
        </button>
        <button
          onClick={onConfirm}
          disabled={rien || busy}
          style={{ ...actionBtn(colors.forest, '#fff'), opacity: rien ? 0.5 : 1 }}
        >
          <Check size={13} />
          {busy ? 'Crédit en cours…' : `Confirmer et créditer ${preview.aCrediter.length} compte${preview.aCrediter.length > 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}

function ConfirmedStep({ confirmation, onRestart }) {
  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 30, height: 30, borderRadius: 15, background: colors.forestPale, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Check size={16} color={colors.forestLight} />
        </div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          {confirmation.credited.length} compte{confirmation.credited.length > 1 ? 's' : ''} crédité{confirmation.credited.length > 1 ? 's' : ''}
        </p>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
        Référence <span style={{ fontFamily: fonts.mono }}>{confirmation.reference}</span> · Total {pct(confirmation.total)}
      </p>
      <button onClick={onRestart} style={actionBtn(colors.forestPale, colors.forestLight)}>
        Importer un autre fichier
      </button>
    </Card>
  );
}

function motifLabel(motif) {
  const labels = {
    client_introuvable: 'Client introuvable',
    nom_ambigu: 'Nom partagé par plusieurs clients',
    deja_credite_ce_mois: 'Déjà crédité pour cette période',
    montant_invalide: 'Montant invalide',
    identifiant_manquant: 'Identifiant manquant',
    colonnes_manquantes: 'Colonne manquante',
  };
  return labels[motif] ?? motif;
}

/* ═══════════════════════════════════════════════════════════════════
   VÉRIFICATION — relevé de contrôle + transactions, annulation par ligne
   ═══════════════════════════════════════════════════════════════════ */

function Verification() {
  const [debut, setDebut] = useState(firstOfMonthISO());
  const [fin, setFin] = useState(todayISO());
  const [typeFiltre, setTypeFiltre] = useState('');
  const [report, setReport] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [scheduler, setScheduler] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [motif, setMotif] = useState('');
  const [busyId, setBusyId] = useState(null);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 5000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [r, t, s] = await Promise.all([
        fetchMonthlyReport(debut, fin),
        fetchTransactions(debut, fin, typeFiltre || undefined),
        fetchSchedulerStatus(),
      ]);
      setReport(r);
      setTransactions(t);
      setScheduler(s);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openConfirm = (id) => {
    setConfirmingId(id);
    setMotif('');
  };

  const doReverse = async (tx) => {
    if (motif.trim().length < 5) return;
    setBusyId(tx.id);
    try {
      await reverseLedgerTransaction(tx.id, motif.trim());
      setTransactions((prev) => prev.map((t) => (t.id === tx.id ? { ...t, annulee: true } : t)));
      setConfirmingId(null);
      flash(`Transaction annulée : ${formatFCFA(Math.abs(tx.montant))} F restaurés sur le compte de ${tx.client}.`);
      const r = await fetchMonthlyReport(debut, fin);
      setReport(r);
    } catch (e) {
      flash(e.message ?? "L'annulation a échoué.");
    } finally {
      setBusyId(null);
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

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={label}>Du</label>
            <input style={input} type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
          </div>
          <div>
            <label style={label}>Au</label>
            <input style={input} type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
          </div>
          <div>
            <label style={label}>Type</label>
            <select style={input} value={typeFiltre} onChange={(e) => setTypeFiltre(e.target.value)}>
              <option value="">Tous</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={loading} style={actionBtn(colors.forest, '#fff')}>
            <Search size={13} /> {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        </div>
      </Card>

      {scheduler && <SchedulerStatus scheduler={scheduler} />}

      {report && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <MiniKpi label="Salaires crédités" nombre={report.salairesCredites.nombre} total={report.salairesCredites.total} />
          <MiniKpi label="Échéances prélevées" nombre={report.echeancesPrelevees.nombre} total={report.echeancesPrelevees.total} />
          <MiniKpi label="Échéances en retard" nombre={report.echeancesEnRetard.nombre} total={report.echeancesEnRetard.total} tone="danger" />
          <MiniKpi label="Agios prélevés" nombre={report.agiosPreleves.nombre} total={report.agiosPreleves.total} />
        </div>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>{transactions.length} transaction{transactions.length > 1 ? 's' : ''}</SectionTitle>

        {transactions.length === 0 && !loading && (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucune transaction sur cette période.
          </p>
        )}

        {transactions.map((t) => (
          <div key={t.id} style={{ borderBottom: `1px solid ${colors.line}` }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              padding: '13px 20px', opacity: t.annulee ? 0.55 : 1,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>{t.client}</span>
                  <Badge tone="neutral">{TYPE_LABELS[t.type] ?? t.type}</Badge>
                  {t.annulee && <Badge tone="danger">Annulée</Badge>}
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  {t.reference ?? '—'} · {new Date(t.date).toLocaleDateString('fr-FR')} · par {t.effectuePar}
                </p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: fonts.mono, color: t.montant >= 0 ? colors.forestLight : colors.danger }}>
                {t.montant >= 0 ? '+' : ''}{formatFCFA(t.montant)} F
              </span>
              {!t.annulee && (
                <button
                  onClick={() => openConfirm(t.id)}
                  disabled={busyId === t.id}
                  style={actionBtn(colors.dangerPale, colors.danger)}
                  title="Annuler cette transaction"
                >
                  <Undo2 size={13} /> Annuler
                </button>
              )}
            </div>

            {confirmingId === t.id && (
              <div style={{ padding: '0 20px 16px' }}>
                <Card style={{ padding: 14, background: colors.bg }}>
                  <p style={{ margin: '0 0 8px', fontSize: 11, color: colors.ink, fontFamily: fonts.body }}>
                    Confirmer l'annulation de cette transaction ({formatFCFA(Math.abs(t.montant))} F) ?
                    Une écriture inverse sera créée — rien n'est supprimé.
                  </p>
                  <input
                    style={{ ...input, marginBottom: 10 }}
                    placeholder="Motif de l'annulation (obligatoire)"
                    value={motif} onChange={(e) => setMotif(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => doReverse(t)}
                      disabled={motif.trim().length < 5 || busyId === t.id}
                      style={{ ...actionBtn(colors.danger, '#fff'), opacity: motif.trim().length < 5 ? 0.5 : 1 }}
                    >
                      {busyId === t.id ? 'Annulation…' : "Confirmer l'annulation"}
                    </button>
                    <button onClick={() => setConfirmingId(null)} style={actionBtn('transparent', colors.muted)}>
                      <X size={13} /> Fermer
                    </button>
                  </div>
                </Card>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

/**
 * Indicateur de ce que le logiciel a fait tout seul : dernière collecte
 * automatique des échéances (chaque jour) et des agios (le 30 du mois).
 * C'est ce qui permet à l'opérateur de vérifier d'un coup d'œil que
 * les tâches planifiées ont bien tourné, avant de contrôler le détail
 * ci-dessous.
 */
function SchedulerStatus({ scheduler }) {
  const formatWhen = (iso) => {
    if (!iso) return 'jamais exécutée';
    const d = new Date(iso);
    return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
      <Card style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 17, background: colors.forestPale,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Clock size={16} color={colors.forestLight} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 10, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Échéances — collecte quotidienne (6h)
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Dernière exécution : {formatWhen(scheduler.echeances?.derniereExecution)}
          </p>
          {scheduler.echeances?.derniereExecution && (
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {scheduler.echeances.payees ?? 0} prélevée{(scheduler.echeances.payees ?? 0) > 1 ? 's' : ''} ·{' '}
              {scheduler.echeances.retards ?? 0} en retard · {formatFCFA(scheduler.echeances.total ?? 0)} F
            </p>
          )}
        </div>
      </Card>

      <Card style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 17, background: colors.forestPale,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Clock size={16} color={colors.forestLight} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 10, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Agios — prélèvement mensuel (le 30, 3h)
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Dernière exécution : {formatWhen(scheduler.agios?.derniereExecution)}
          </p>
          {scheduler.agios?.derniereExecution && (
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {scheduler.agios.comptes ?? 0} compte{(scheduler.agios.comptes ?? 0) > 1 ? 's' : ''} · {formatFCFA(scheduler.agios.total ?? 0)} F
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function MiniKpi({ label: l, nombre, total, tone = 'neutral' }) {
  return (
    <Card style={{ padding: 14 }}>
      <p style={{ margin: 0, fontSize: 10, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>{l}</p>
      <p style={{ margin: '6px 0 2px', fontSize: 17, fontWeight: 700, color: tone === 'danger' && nombre > 0 ? colors.danger : colors.ink, fontFamily: fonts.mono }}>
        {nombre}
      </p>
      <p style={{ margin: 0, fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>{formatFCFA(total)} F</p>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CORRECTION D'ÉCHÉANCE — recherche par référence
   ═══════════════════════════════════════════════════════════════════ */

function InstallmentCorrection() {
  const [reference, setReference] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nouvelleDate, setNouvelleDate] = useState('');
  const [motif, setMotif] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const search = async () => {
    if (!reference.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await fetchInstallmentsByReference(reference.trim().toUpperCase());
      setResult(r);
    } catch (e) {
      setError(e.message ?? 'Dossier introuvable.');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (inst) => {
    setEditingId(inst.id);
    setNouvelleDate(inst.dueDate);
    setMotif('');
  };

  const submit = async (inst) => {
    if (motif.trim().length < 5) return;
    setBusyId(inst.id);
    try {
      await proposeInstallmentAdjustment(inst.id, nouvelleDate, motif.trim());
      setResult((prev) => ({
        ...prev,
        installments: prev.installments.map((i) =>
          i.id === inst.id ? { ...i, pendingRequestId: `local-${Date.now()}` } : i
        ),
      }));
      setEditingId(null);
      setToast(
        `Correction proposée pour l'échéance n°${inst.sequence} (nouvelle date : ${new Date(nouvelleDate).toLocaleDateString('fr-FR')}). ` +
        `En attente de validation du directeur — rien n'est encore modifié.`
      );
      setTimeout(() => setToast(''), 6000);
    } catch (e) {
      setError(e.message ?? 'La proposition a échoué.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          Corriger une échéance
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Seule une échéance pas encore prélevée peut être corrigée. La proposition n'entre en
          vigueur qu'après validation du directeur — vous ne modifiez jamais la date vous-même.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={input} placeholder="Référence du crédit, ex. CPG-4400"
            value={reference} onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <button onClick={search} disabled={loading} style={actionBtn(colors.forest, '#fff')}>
            <Search size={13} /> {loading ? 'Recherche…' : 'Rechercher'}
          </button>
        </div>
        {error && <p style={{ margin: '10px 0 0', fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{error}</p>}
      </Card>

      {toast && (
        <div style={{
          background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.goldDark, fontFamily: fonts.body,
        }}>
          {toast}
        </div>
      )}

      {result && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SectionTitle>{result.credit.reference} · {result.credit.client}</SectionTitle>
          {result.installments.map((inst) => (
            <div key={inst.id} style={{ borderBottom: `1px solid ${colors.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 20px' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                    Échéance {inst.sequence}
                  </span>
                  <Badge tone={inst.status === 'payee' ? 'neutral' : inst.status === 'en_retard' ? 'danger' : 'gold'}>
                    {inst.status === 'payee' ? 'Payée' : inst.status === 'en_retard' ? 'En retard' : 'À venir'}
                  </Badge>
                  {inst.pendingRequestId && <Badge tone="gold">En attente du directeur</Badge>}
                  {inst.originalDueDate && (
                    <p style={{ margin: '4px 0 0', fontSize: 10, color: colors.muted, fontFamily: fonts.body }}>
                      Date d'origine : {new Date(inst.originalDueDate).toLocaleDateString('fr-FR')}
                    </p>
                  )}
                </div>
                <span style={{ fontSize: 12, color: colors.ink, fontFamily: fonts.mono }}>
                  {new Date(inst.dueDate).toLocaleDateString('fr-FR')}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                  {formatFCFA(inst.amount)} F
                </span>
                {inst.status === 'a_venir' && !inst.pendingRequestId && editingId !== inst.id && (
                  <button onClick={() => startEdit(inst)} style={actionBtn(colors.forestPale, colors.forestLight)}>
                    <Pencil size={12} /> Proposer une correction
                  </button>
                )}
              </div>
              {editingId === inst.id && (
                <div style={{ padding: '0 20px 16px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                      style={{ ...input, width: 180 }} type="date"
                      value={nouvelleDate} onChange={(e) => setNouvelleDate(e.target.value)}
                    />
                    <input
                      style={input} placeholder="Motif de la correction (obligatoire)"
                      value={motif} onChange={(e) => setMotif(e.target.value)}
                    />
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: 10, color: colors.muted, fontFamily: fonts.body }}>
                    Cette date ne s'appliquera qu'après validation du directeur.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => submit(inst)}
                      disabled={busyId === inst.id || motif.trim().length < 5}
                      style={{ ...actionBtn(colors.forest, '#fff'), opacity: motif.trim().length < 5 ? 0.5 : 1 }}
                    >
                      {busyId === inst.id ? 'Envoi…' : 'Soumettre au directeur'}
                    </button>
                    <button onClick={() => setEditingId(null)} style={actionBtn('transparent', colors.muted)}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
