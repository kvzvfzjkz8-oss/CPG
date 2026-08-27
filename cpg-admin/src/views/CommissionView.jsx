import React, { useState, useEffect } from 'react';
import {
  CalendarPlus, ListChecks, Gavel, Inbox, AlertTriangle, Sparkles, Check, X,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, SectionTitle } from '../components/UI';
import {
  fetchCommissionSession, scheduleCommissionSession, cancelCommissionSession,
  fetchLevel1Credits, depositCreditToCommission,
  fetchCommissionAgenda, depositDifficultyCase, depositExceptionalRequest,
  holdCommissionSession,
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

function Toast({ text }) {
  if (!text) return null;
  return (
    <div style={{
      background: colors.goldPale, border: `1px solid ${colors.gold}`, borderRadius: 12,
      padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.goldDark, fontFamily: fonts.body,
    }}>
      {text}
    </div>
  );
}

export default function CommissionView() {
  const [tab, setTab] = useState('seance');
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const loadSession = async () => {
    setLoadingSession(true);
    try {
      const s = await fetchCommissionSession();
      setSession(s);
    } finally {
      setLoadingSession(false);
    }
  };

  useEffect(() => { loadSession(); }, []);

  const hasOpenSession = session?.status === 'planifiee';

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: 'seance', label: 'Séance', icon: CalendarPlus },
          { key: 'deposer', label: 'Déposer un dossier', icon: Inbox },
          { key: 'tenir', label: 'Tenir la séance', icon: Gavel },
        ]}
      />
      {tab === 'seance' && (
        <SessionPanel session={session} loading={loadingSession} onChange={loadSession} />
      )}
      {tab === 'deposer' && (
        <DepositPanel hasOpenSession={hasOpenSession} />
      )}
      {tab === 'tenir' && (
        <HoldSessionPanel session={session} onHeld={loadSession} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SÉANCE — programmer, annuler
   ═══════════════════════════════════════════════════════════════════ */

function SessionPanel({ session, loading, onChange }) {
  const [dateHeure, setDateHeure] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 5000);
  };

  const schedule = async () => {
    if (!dateHeure) return;
    setBusy(true);
    setError('');
    try {
      await scheduleCommissionSession(dateHeure);
      flash('Commission programmée.');
      setDateHeure('');
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      await cancelCommissionSession(session.id);
      flash('Commission annulée.');
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Card style={{ padding: 20 }}>Chargement…</Card>;

  return (
    <div>
      <Toast text={toast} />
      {error && (
        <div style={{
          background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.danger, fontFamily: fonts.body,
        }}>
          {error}
        </div>
      )}

      {session?.status === 'planifiee' ? (
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Badge tone="gold">Programmée</Badge>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
              {new Date(session.scheduledFor).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}
            </p>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
            Programmée par {session.scheduledBy}. Déposez les dossiers dans l'onglet « Déposer », puis tenez la
            séance dans l'onglet « Tenir la séance » une fois l'ordre du jour complet.
          </p>
          <button onClick={cancel} disabled={busy} style={actionBtn(colors.dangerPale, colors.danger)}>
            <X size={13} /> Annuler la séance
          </button>
        </Card>
      ) : (
        <Card style={{ padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
            Programmer la commission
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
            Une commission doit se tenir chaque semaine. Aucun dossier ne peut être déposé tant qu'aucune
            séance n'est programmée.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Date et heure</label>
              <input style={input} type="datetime-local" value={dateHeure} onChange={(e) => setDateHeure(e.target.value)} />
            </div>
            <button onClick={schedule} disabled={!dateHeure || busy} style={actionBtn(colors.forest, '#fff')}>
              <CalendarPlus size={13} /> Programmer
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DÉPOSER — nouveaux dossiers, difficultés, demandes exceptionnelles
   ═══════════════════════════════════════════════════════════════════ */

function DepositPanel({ hasOpenSession }) {
  const [sub, setSub] = useState('nouveaux');

  return (
    <div>
      {!hasOpenSession && (
        <div style={{
          background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.danger, fontFamily: fonts.body,
        }}>
          Aucune commission n'est programmée. Programmez une séance dans l'onglet « Séance » avant de déposer un dossier.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'nouveaux', label: 'Nouveaux dossiers', icon: Inbox },
          { key: 'difficulte', label: 'Dossier en difficulté', icon: AlertTriangle },
          { key: 'exceptionnelle', label: 'Demande exceptionnelle', icon: Sparkles },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9,
              border: `1px solid ${sub === s.key ? colors.forest : colors.line}`,
              background: sub === s.key ? colors.forestPale : '#fff',
              color: sub === s.key ? colors.forestLight : colors.muted,
              fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer',
            }}
          >
            <s.icon size={13} /> {s.label}
          </button>
        ))}
      </div>

      {sub === 'nouveaux' && <NewCreditsDeposit hasOpenSession={hasOpenSession} />}
      {sub === 'difficulte' && <DifficultyDeposit hasOpenSession={hasOpenSession} />}
      {sub === 'exceptionnelle' && <ExceptionalDeposit hasOpenSession={hasOpenSession} />}
    </div>
  );
}

function NewCreditsDeposit({ hasOpenSession }) {
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const c = await fetchLevel1Credits();
      setCredits(c);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 5000);
  };

  const deposit = async (credit) => {
    setBusyId(credit.id);
    try {
      await depositCreditToCommission(credit.id, notes[credit.id] ?? '');
      flash(`${credit.id} déposé dans l'ordre du jour de la commission.`);
      await load();
    } catch (e) {
      flash(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <Toast text={toast} />
      <SectionTitle>{credits.length} dossier{credits.length > 1 ? 's' : ''} validé{credits.length > 1 ? 's' : ''} niveau 1</SectionTitle>
      {!loading && credits.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucun dossier en attente de dépôt.
        </p>
      )}
      {credits.map((c) => (
        <div key={c.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${colors.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                {c.client} · {c.id}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                {c.poste} · {formatFCFA(c.montant)} F sur {c.duree} mois
              </p>
            </div>
            <button
              onClick={() => deposit(c)}
              disabled={!hasOpenSession || busyId === c.id}
              style={{ ...actionBtn(colors.forest, '#fff'), opacity: hasOpenSession ? 1 : 0.5 }}
            >
              <Inbox size={12} /> Déposer
            </button>
          </div>
          <input
            style={input} placeholder="Note d'analyse pour la commission (optionnel)"
            value={notes[c.id] ?? ''}
            onChange={(e) => setNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
          />
        </div>
      ))}
    </Card>
  );
}

function DifficultyDeposit({ hasOpenSession }) {
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const submit = async () => {
    if (!reference.trim()) return;
    setBusy(true);
    setError('');
    try {
      await depositDifficultyCase(reference.trim().toUpperCase(), note.trim());
      setToast(`Dossier ${reference.trim().toUpperCase()} déposé pour difficulté.`);
      setTimeout(() => setToast(''), 5000);
      setReference('');
      setNote('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ padding: 20 }}>
      <Toast text={toast} />
      <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        Déposer un dossier en difficulté
      </p>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
        Réservé à un crédit actif ayant au moins une échéance en retard. La commission décide d'une
        orientation ; les actions concrètes (décaler une échéance, par exemple) se font ensuite via les
        outils déjà en place.
      </p>
      {error && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{error}</p>
      )}
      <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={label}>Référence du crédit</label>
          <input style={input} placeholder="ex. CPG-4451" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div>
          <label style={label}>Note pour la commission</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Décrivez la situation" />
        </div>
      </div>
      <button
        onClick={submit}
        disabled={!hasOpenSession || !reference.trim() || busy}
        style={{ ...actionBtn(colors.forest, '#fff'), opacity: hasOpenSession ? 1 : 0.5 }}
      >
        <AlertTriangle size={13} /> Déposer pour difficulté
      </button>
    </Card>
  );
}

function ExceptionalDeposit({ hasOpenSession }) {
  const [clientId, setClientId] = useState('');
  const [titre, setTitre] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await depositExceptionalRequest(clientId.trim(), titre, note.trim());
      setToast('Demande exceptionnelle déposée.');
      setTimeout(() => setToast(''), 5000);
      setClientId('');
      setTitre('');
      setNote('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ padding: 20 }}>
      <Toast text={toast} />
      <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        Déposer une demande exceptionnelle
      </p>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
        Toujours rattachée à un client — pas de sujet flottant impossible à retrouver ensuite.
      </p>
      {error && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{error}</p>
      )}
      <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={label}>Numéro client ou téléphone</label>
          <input style={input} placeholder="ex. CPG-00931" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </div>
        <div>
          <label style={label}>Titre</label>
          <input style={input} value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Résumé pour l'ordre du jour" />
        </div>
        <div>
          <label style={label}>Note</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Détails pour la commission" />
        </div>
      </div>
      <button
        onClick={submit}
        disabled={!hasOpenSession || !clientId.trim() || titre.trim().length < 3 || busy}
        style={{ ...actionBtn(colors.forest, '#fff'), opacity: hasOpenSession ? 1 : 0.5 }}
      >
        <Sparkles size={13} /> Déposer la demande
      </button>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TENIR LA SÉANCE — décisions par point
   ═══════════════════════════════════════════════════════════════════ */

function HoldSessionPanel({ session, onHeld }) {
  const [agenda, setAgenda] = useState({ credits: [], points: [] });
  const [loading, setLoading] = useState(true);
  const [decisions, setDecisions] = useState({});
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const load = async () => {
    if (!session?.id) {
      setAgenda({ credits: [], points: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const a = await fetchCommissionAgenda(session.id);
      setAgenda(a);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDecision = (kind, id, decision) => {
    setDecisions((prev) => ({ ...prev, [`${kind}:${id}`]: decision }));
  };

  const totalPoints = agenda.credits.length + agenda.points.length;
  const decidedCount = Object.keys(decisions).length;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = [
        ...agenda.credits.map((c) => ({ kind: 'credit', id: c.id, decision: decisions[`credit:${c.id}`], note: notes[`credit:${c.id}`] })),
        ...agenda.points.map((p) => ({ kind: 'item', id: p.id, decision: decisions[`item:${p.id}`], note: notes[`item:${p.id}`] })),
      ];
      const result = await holdCommissionSession(session.id, payload);
      setToast(`Séance tenue : ${result.resultats.length} point(s) tranché(s).`);
      setTimeout(() => setToast(''), 6000);
      setDecisions({});
      setNotes({});
      onHeld();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Card style={{ padding: 20 }}>Chargement…</Card>;

  if (session?.status !== 'planifiee') {
    return (
      <Card style={{ padding: 28, textAlign: 'center' }}>
        <p style={{ margin: 0, color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucune séance programmée à tenir pour le moment.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <Toast text={toast} />
      {error && (
        <div style={{
          background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.danger, fontFamily: fonts.body,
        }}>
          {error}
        </div>
      )}

      {totalPoints === 0 ? (
        <Card style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ margin: 0, color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucun dossier déposé pour cette séance. Utilisez l'onglet « Déposer un dossier ».
          </p>
        </Card>
      ) : (
        <>
          <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
            <SectionTitle>{totalPoints} point{totalPoints > 1 ? 's' : ''} à l'ordre du jour</SectionTitle>

            {agenda.credits.map((c) => (
              <AgendaRow
                key={`credit:${c.id}`}
                titre={`${c.client} · ${c.id}`}
                sousTitre={`${c.poste} · ${formatFCFA(c.montant)} F sur ${c.duree} mois${c.commissionNote ? ` — ${c.commissionNote}` : ''}`}
                badge="Nouveau crédit"
                decision={decisions[`credit:${c.id}`]}
                onDecision={(d) => setDecision('credit', c.id, d)}
                note={notes[`credit:${c.id}`] ?? ''}
                onNote={(v) => setNotes((prev) => ({ ...prev, [`credit:${c.id}`]: v }))}
              />
            ))}
            {agenda.points.map((p) => (
              <AgendaRow
                key={`item:${p.id}`}
                titre={p.titre}
                sousTitre={p.note}
                badge={p.type === 'dossier_difficulte' ? 'Dossier en difficulté' : 'Demande exceptionnelle'}
                badgeTone={p.type === 'dossier_difficulte' ? 'danger' : 'gold'}
                decision={decisions[`item:${p.id}`]}
                onDecision={(d) => setDecision('item', p.id, d)}
                note={notes[`item:${p.id}`] ?? ''}
                onNote={(v) => setNotes((prev) => ({ ...prev, [`item:${p.id}`]: v }))}
              />
            ))}
          </Card>

          <button
            onClick={submit}
            disabled={decidedCount < totalPoints || busy}
            style={{ ...actionBtn(colors.forest, '#fff'), opacity: decidedCount < totalPoints ? 0.5 : 1 }}
          >
            <ListChecks size={13} />
            {busy ? 'Enregistrement…' : `Clore la séance (${decidedCount}/${totalPoints} tranchés)`}
          </button>
        </>
      )}
    </div>
  );
}

function AgendaRow({ titre, sousTitre, badge, badgeTone = 'neutral', decision, onDecision, note, onNote }) {
  return (
    <div style={{ padding: '14px 20px', borderBottom: `1px solid ${colors.line}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>{titre}</span>
            <Badge tone={badgeTone}>{badge}</Badge>
          </div>
          {sousTitre && (
            <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>{sousTitre}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => onDecision('valide')}
            style={actionBtn(decision === 'valide' ? colors.forest : colors.forestPale, decision === 'valide' ? '#fff' : colors.forestLight)}
          >
            <Check size={12} /> Valider
          </button>
          <button
            onClick={() => onDecision('rejete')}
            style={actionBtn(decision === 'rejete' ? colors.danger : colors.dangerPale, decision === 'rejete' ? '#fff' : colors.danger)}
          >
            <X size={12} /> Rejeter
          </button>
        </div>
      </div>
      {decision && (
        <input
          style={input} placeholder="Note de décision (optionnel)"
          value={note} onChange={(e) => onNote(e.target.value)}
        />
      )}
    </div>
  );
}
