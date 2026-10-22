import React, { useState, useEffect } from 'react';
import {
  CalendarPlus, ListChecks, Gavel, Inbox, AlertTriangle, Sparkles, Check, X, Wallet, Pencil,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, SectionTitle } from '../components/UI';
import { can } from '../auth/roles';
import {
  fetchCommissionSession, scheduleCommissionSession, cancelCommissionSession, rescheduleCommissionSession,
  fetchLevel1Credits, depositCreditToCommission,
  fetchCommissionAgenda, depositDifficultyCase, depositExceptionalRequest,
  holdCommissionSession, searchClientPourDemande, fetchCreditRequests,
  definirPlafondCommission, ajusterDossierCommission,
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

/**
 * L'ENVELOPPE DE LA SÉANCE
 *
 * « Chaque commission doit avoir un montant plafonné donné par le
 *   directeur. Ce montant peut être dépassé tant que la commission n'a
 *   pas été tenue, mais durant la tenue de la séance les noms et les
 *   montants qui vont être validés ne doivent pas dépasser ce montant. »
 *
 * Trois chiffres, toujours visibles : autorisé, déposé, reste. Le reste
 * passe au rouge quand les dépôts dépassent — c'est un signal, pas un
 * blocage : déposer n'engage aucun franc, c'est en séance que la
 * limite s'applique.
 *
 * Seul le directeur peut fixer ou corriger le montant. Le gestionnaire
 * le voit, dépose en connaissance de cause, mais n'y touche pas.
 */
function EnveloppePanel({ session, role, onChange }) {
  const peutDefinir = can(role, 'commission.definir_plafond');
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState('');
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');

  const e = session?.enveloppe;
  const plafond = e?.plafond ?? null;
  const depasse = (e?.depassement ?? 0) > 0;

  const enregistrer = async (montant) => {
    setBusy(true);
    setErreur('');
    try {
      await definirPlafondCommission(session.id, montant);
      setEdition(false);
      setValeur('');
      onChange();
    } catch (err) {
      setErreur(err.message ?? "L'enveloppe n'a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  };

  const chiffre = (titre, montant, ton) => (
    <div style={{ flex: '1 1 150px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {titre}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: fonts.mono, color: ton ?? colors.ink, marginTop: 2 }}>
        {montant === null ? '—' : `${formatFCFA(montant)} F`}
      </div>
    </div>
  );

  return (
    <Card style={{
      padding: 18, marginBottom: 16,
      borderColor: depasse ? colors.gold : colors.line,
      background: depasse ? colors.goldPale : colors.card,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Wallet size={15} color={colors.forestLight} />
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          Enveloppe de la séance
        </p>
        {plafond === null && <Badge tone="neutral">non fixée</Badge>}
        {depasse && <Badge tone="gold">dépassée</Badge>}
      </div>

      {erreur && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{erreur}</p>
      )}

      {plafond === null ? (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Aucun montant n'a été fixé pour cette séance : rien ne limitera les validations.
          {peutDefinir
            ? ' Fixez l\'enveloppe pour plafonner ce qui pourra être octroyé ce jour-là.'
            : ' Seul le directeur peut la fixer.'}
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
            {chiffre('Autorisé', plafond)}
            {chiffre('Déposé', e.depose)}
            {chiffre('Reste', e.reste, e.reste < 0 ? colors.danger : colors.forestLight)}
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 11.5, color: depasse ? colors.goldDark : colors.muted, fontFamily: fonts.body }}>
            {depasse
              ? `Les dépôts dépassent l'enveloppe de ${formatFCFA(e.depassement)} F. Vous pouvez continuer à déposer — mais en séance, la somme des dossiers validés ne pourra pas franchir ${formatFCFA(plafond)} F. Retirez les dossiers excédentaires de la file avant de tenir la séance : ils resteront disponibles pour une prochaine.`
              : `${e.dossiersDeposes} dossier${e.dossiersDeposes > 1 ? 's' : ''} déposé${e.dossiersDeposes > 1 ? 's' : ''}. En séance, la somme des dossiers validés ne pourra pas dépasser ce montant.`}
          </p>
        </>
      )}

      {peutDefinir && !edition && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setEdition(true); setValeur(plafond ? String(plafond) : ''); }} disabled={busy} style={actionBtn(colors.forestPale, colors.forestLight)}>
            <Wallet size={13} /> {plafond === null ? 'Fixer l\'enveloppe' : 'Modifier'}
          </button>
          {plafond !== null && (
            <button onClick={() => enregistrer(null)} disabled={busy} style={actionBtn('transparent', colors.muted)}>
              Retirer l'enveloppe
            </button>
          )}
        </div>
      )}

      {peutDefinir && edition && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, maxWidth: 240 }}>
            <label style={label}>Montant maximum (FCFA)</label>
            <input
              style={{ ...input, fontFamily: fonts.mono }}
              inputMode="numeric"
              autoFocus
              placeholder="0"
              value={valeur}
              onChange={(ev) => setValeur(ev.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <button
            onClick={() => enregistrer(Number(valeur))}
            disabled={busy || !valeur || Number(valeur) <= 0}
            style={actionBtn(colors.forest, '#fff')}
          >
            Enregistrer
          </button>
          <button onClick={() => { setEdition(false); setErreur(''); }} disabled={busy} style={actionBtn('transparent', colors.muted)}>
            Annuler
          </button>
        </div>
      )}
    </Card>
  );
}

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

export default function CommissionView({ role }) {
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
        <SessionPanel session={session} loading={loadingSession} onChange={loadSession} role={role} />
      )}
      {tab === 'deposer' && (
        <DepositPanel hasOpenSession={hasOpenSession} role={role} sessionId={session?.id} />
      )}
      {tab === 'tenir' && (
        <HoldSessionPanel session={session} onHeld={loadSession} role={role} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SÉANCE — programmer, annuler
   ═══════════════════════════════════════════════════════════════════ */

function SessionPanel({ session, loading, onChange, role }) {
  const peutProgrammer = can(role, 'commission.programmer');
  const [dateHeure, setDateHeure] = useState('');
  const [editing, setEditing] = useState(false);
  const [nouvelleDate, setNouvelleDate] = useState('');
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

  const reschedule = async () => {
    if (!nouvelleDate) return;
    setBusy(true);
    setError('');
    try {
      await rescheduleCommissionSession(session.id, nouvelleDate);
      flash('Date de la commission modifiée.');
      setEditing(false);
      setNouvelleDate('');
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

  const dateValide = session?.scheduled_for && !Number.isNaN(new Date(session.scheduled_for).getTime());

  return (
    <div>
      <Toast text={toast} />
      {session?.status === 'planifiee' && (
        <EnveloppePanel session={session} role={role} onChange={onChange} />
      )}
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
            <Badge tone="gold">Commission programmée</Badge>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
              {dateValide
                ? new Date(session.scheduled_for).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
                : 'Date à confirmer'}
            </p>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
            {session.scheduled_by_name ? `Programmée par ${session.scheduled_by_name}. ` : ''}
            Déposez les dossiers dans l'onglet « Déposer », puis tenez la
            séance dans l'onglet « Tenir la séance » une fois l'ordre du jour complet.
          </p>

          {peutProgrammer && !editing && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditing(true)} disabled={busy} style={actionBtn(colors.forestPale, colors.forestLight)}>
                <CalendarPlus size={13} /> Modifier la date
              </button>
              <button onClick={cancel} disabled={busy} style={actionBtn(colors.dangerPale, colors.danger)}>
                <X size={13} /> Annuler la séance
              </button>
            </div>
          )}

          {peutProgrammer && editing && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={label}>Nouvelle date et heure</label>
                <input style={input} type="datetime-local" value={nouvelleDate} onChange={(e) => setNouvelleDate(e.target.value)} />
              </div>
              <button onClick={reschedule} disabled={!nouvelleDate || busy} style={actionBtn(colors.forest, '#fff')}>
                Confirmer
              </button>
              <button onClick={() => setEditing(false)} disabled={busy} style={actionBtn('transparent', colors.muted)}>
                Annuler
              </button>
            </div>
          )}
        </Card>
      ) : (
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Badge tone="neutral">Aucune commission en cours</Badge>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
            Une commission doit se tenir chaque semaine. Aucun dossier ne peut être déposé tant qu'aucune
            séance n'est programmée.
          </p>
          {peutProgrammer ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={label}>Date et heure</label>
                <input style={input} type="datetime-local" value={dateHeure} onChange={(e) => setDateHeure(e.target.value)} />
              </div>
              <button onClick={schedule} disabled={!dateHeure || busy} style={actionBtn(colors.forest, '#fff')}>
                <CalendarPlus size={13} /> Programmer
              </button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontFamily: fonts.body, fontStyle: 'italic' }}>
              Aucune séance programmée pour le moment.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DÉPOSER — nouveaux dossiers, difficultés, demandes exceptionnelles
   ═══════════════════════════════════════════════════════════════════ */

function DepositPanel({ hasOpenSession, role, sessionId }) {
  const [sub, setSub] = useState('nouveaux');

  if (!can(role, 'commission.deposer')) {
    return (
      <Card style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 13, color: colors.muted, fontFamily: fonts.body }}>
          Le dépôt des dossiers en commission revient au gestionnaire. Consultez l'onglet « Tenir la séance »
          pour voir les dossiers déjà déposés et leur décision.
        </p>
      </Card>
    );
  }

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
      {sub === 'difficulte' && <DifficultyDeposit hasOpenSession={hasOpenSession} sessionId={sessionId} />}
      {sub === 'exceptionnelle' && <ExceptionalDeposit hasOpenSession={hasOpenSession} sessionId={sessionId} />}
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
      {credits.map((c) => {
        // Un client déjà en crédit ne repasse en commission qu'avec une
        // autorisation d'exception du directeur, accordée en validant une
        // demande exceptionnelle en séance. Tant qu'elle manque, le
        // serveur refusera le dépôt : autant le dire avant le clic.
        const autorisationManquante = c.credit_en_cours && !c.autorisation_exception_disponible;
        const depotImpossible = !hasOpenSession || autorisationManquante;

        return (
          <div key={c.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${colors.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                  {c.client} · {c.id}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  {c.job_title ?? c.employer ?? '—'} · {formatFCFA(c.amount)} F sur {c.duration_months} mois
                </p>
                {c.credit_en_cours && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: 11,
                      fontWeight: 500,
                      color: autorisationManquante ? '#9A3412' : colors.forest,
                      fontFamily: fonts.body,
                    }}
                  >
                    {autorisationManquante
                      ? 'Crédit en cours — en attente d’une demande exceptionnelle validée par le directeur'
                      : 'Crédit en cours — autorisation exceptionnelle accordée, dépôt possible'}
                  </p>
                )}
              </div>
              <button
                onClick={() => deposit(c)}
                disabled={depotImpossible || busyId === c.id}
                title={
                  autorisationManquante
                    ? 'Ce client a déjà un crédit en cours. Déposez une demande exceptionnelle et faites-la valider par le directeur en séance.'
                    : undefined
                }
                style={{ ...actionBtn(colors.forest, '#fff'), opacity: depotImpossible ? 0.5 : 1 }}
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
        );
      })}
    </Card>
  );
}

function DifficultyDeposit({ hasOpenSession, sessionId }) {
  const [query, setQuery] = useState('');
  const [credit, setCredit] = useState(null);
  const [actifs, setActifs] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [deposees, setDeposees] = useState([]);
  const [loadingListe, setLoadingListe] = useState(true);

  useEffect(() => {
    fetchCreditRequests('approuve').then(setActifs).catch(() => setActifs([]));
  }, []);

  const resultats = query.trim().length < 2 ? [] : actifs.filter((c) => {
    const q = query.trim().toLowerCase();
    return c.reference?.toLowerCase().includes(q)
      || c.client?.toLowerCase().includes(q)
      || c.client_number?.toLowerCase().includes(q)
      || c.phone?.toLowerCase().includes(q);
  }).slice(0, 8);

  const chargerListe = () => {
    if (!sessionId) { setLoadingListe(false); return; }
    fetchCommissionAgenda(sessionId)
      .then((a) => setDeposees(a.points.filter((p) => p.type === 'dossier_difficulte')))
      .finally(() => setLoadingListe(false));
  };

  useEffect(() => { chargerListe(); }, [sessionId]);

  const submit = async () => {
    if (!credit) return;
    setBusy(true);
    setError('');
    try {
      await depositDifficultyCase(credit.id, note.trim());
      setToast(`Dossier ${credit.reference} déposé pour difficulté.`);
      setTimeout(() => setToast(''), 5000);
      setCredit(null);
      setQuery('');
      setNote('');
      chargerListe();
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
        Pour un crédit actif rencontrant une difficulté — échéance en retard ou situation qui le laisse
        prévoir. La commission décide d'une orientation ; les actions concrètes (décaler une échéance,
        par exemple) se font ensuite via les outils déjà en place.
      </p>
      {error && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: colors.danger, fontFamily: fonts.body }}>{error}</p>
      )}
      <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={label}>Crédit actif</label>
          {!credit ? (
            <>
              <input
                style={input} placeholder="Nom, numéro client (CPG-...) ou téléphone"
                value={query} onChange={(e) => setQuery(e.target.value)}
              />
              {resultats.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {resultats.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setCredit(c); setQuery(''); }}
                      style={{
                        display: 'flex', justifyContent: 'space-between', padding: '9px 12px',
                        borderRadius: 9, border: `1px solid ${colors.line}`, background: '#fff',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>
                        {c.client} <span style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>· {c.client_number}</span>
                      </span>
                      <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{c.reference}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: colors.forestPale, borderRadius: 9, padding: '9px 12px' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.forest, fontFamily: fonts.body }}>{credit.client} · {credit.reference}</span>
              <button type="button" onClick={() => setCredit(null)} style={{ border: 'none', background: 'transparent', color: colors.forestLight, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>
                Changer
              </button>
            </div>
          )}
        </div>
        <div>
          <label style={label}>Note pour la commission</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Décrivez la situation" />
        </div>
      </div>
      <button
        onClick={submit}
        disabled={!hasOpenSession || !credit || busy}
        style={{ ...actionBtn(colors.forest, '#fff'), opacity: hasOpenSession ? 1 : 0.5 }}
      >
        <AlertTriangle size={13} /> Déposer pour difficulté
      </button>

      <p style={{ margin: '22px 0 10px', fontSize: 12, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        Dossiers déjà déposés pour cette séance
      </p>
      {loadingListe ? (
        <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>Chargement…</p>
      ) : deposees.length === 0 ? (
        <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, fontStyle: 'italic' }}>
          Aucun dossier en difficulté déposé pour le moment.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {deposees.map((p) => (
            <div key={p.id} style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, background: colors.bg }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
                {p.client ? `${p.client} — ` : ''}{p.titre}
              </p>
              {p.note && (
                <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>{p.note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ExceptionalDeposit({ hasOpenSession, sessionId }) {
  const [query, setQuery] = useState('');
  const [resultats, setResultats] = useState([]);
  const [client, setClient] = useState(null);
  const [titre, setTitre] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [deposees, setDeposees] = useState([]);
  const [loadingListe, setLoadingListe] = useState(true);

  useEffect(() => {
    if (query.trim().length < 2) { setResultats([]); return; }
    const t = setTimeout(() => {
      searchClientPourDemande(query.trim()).then(setResultats).catch(() => setResultats([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const chargerListe = () => {
    if (!sessionId) { setLoadingListe(false); return; }
    fetchCommissionAgenda(sessionId)
      .then((a) => setDeposees(a.points.filter((p) => p.type === 'demande_exceptionnelle')))
      .finally(() => setLoadingListe(false));
  };

  useEffect(() => { chargerListe(); }, [sessionId]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await depositExceptionalRequest(client.id, titre, note.trim());
      setToast('Demande exceptionnelle déposée.');
      setTimeout(() => setToast(''), 5000);
      setClient(null);
      setQuery('');
      setTitre('');
      setNote('');
      chargerListe();
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
          <label style={label}>Client</label>
          {!client ? (
            <>
              <input
                style={input} placeholder="Nom du client ou numéro de compte"
                value={query} onChange={(e) => setQuery(e.target.value)}
              />
              {resultats.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {resultats.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { setClient(r); setResultats([]); setQuery(''); }}
                      style={{
                        display: 'flex', justifyContent: 'space-between', padding: '9px 12px',
                        borderRadius: 9, border: `1px solid ${colors.line}`, background: '#fff',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>{r.full_name}</span>
                      <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{r.client_number}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: colors.forestPale, borderRadius: 9, padding: '9px 12px' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.forest, fontFamily: fonts.body }}>{client.full_name} · {client.client_number}</span>
              <button type="button" onClick={() => setClient(null)} style={{ border: 'none', background: 'transparent', color: colors.forestLight, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>
                Changer
              </button>
            </div>
          )}
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
        disabled={!hasOpenSession || !client || titre.trim().length < 3 || busy}
        style={{ ...actionBtn(colors.forest, '#fff'), opacity: hasOpenSession ? 1 : 0.5 }}
      >
        <Sparkles size={13} /> Déposer la demande
      </button>

      <p style={{ margin: '22px 0 10px', fontSize: 12, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        Demandes déjà déposées pour cette séance
      </p>
      {loadingListe ? (
        <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>Chargement…</p>
      ) : deposees.length === 0 ? (
        <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, fontStyle: 'italic' }}>
          Aucune demande exceptionnelle déposée pour le moment.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {deposees.map((p) => (
            <div key={p.id} style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, background: colors.bg }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
                {p.client ? `${p.client} — ` : ''}{p.titre}
              </p>
              {p.note && (
                <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>{p.note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TENIR LA SÉANCE — décisions par point
   ═══════════════════════════════════════════════════════════════════ */

function HoldSessionPanel({ session, onHeld, role }) {
  const peutTenir = can(role, 'commission.tenir');
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

  // L'enveloppe, suivie en direct pendant la séance.
  //
  // Seuls les dossiers de crédit la consomment : ce sont eux que la
  // caisse paiera. Le serveur applique exactement la même règle et
  // refusera la séance en cas de dépassement — ce compteur est là pour
  // que le directeur le voie AVANT de cliquer, pas pour le remplacer.
  const plafond = session?.enveloppe?.plafond ?? null;
  const montantValide = agenda.credits
    .filter((c) => decisions[`credit:${c.id}`] === 'valide')
    .reduce((somme, c) => somme + Number(c.amount), 0);
  const excedent = plafond === null ? 0 : Math.max(0, montantValide - plafond);
  const bloqueParEnveloppe = excedent > 0;

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
          {plafond !== null && (
            <Card style={{
              padding: '14px 18px', marginBottom: 16,
              borderColor: bloqueParEnveloppe ? colors.danger : colors.forestLight,
              background: bloqueParEnveloppe ? colors.dangerPale : colors.forestPale,
            }}>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Enveloppe
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: fonts.mono, color: colors.ink }}>
                    {formatFCFA(plafond)} F
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Validé à cet instant
                  </div>
                  <div style={{
                    fontSize: 16, fontWeight: 700, fontFamily: fonts.mono,
                    color: bloqueParEnveloppe ? colors.danger : colors.forestLight,
                  }}>
                    {formatFCFA(montantValide)} F
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Reste
                  </div>
                  <div style={{
                    fontSize: 16, fontWeight: 700, fontFamily: fonts.mono,
                    color: bloqueParEnveloppe ? colors.danger : colors.forestLight,
                  }}>
                    {formatFCFA(plafond - montantValide)} F
                  </div>
                </div>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 11.5, fontFamily: fonts.body, color: bloqueParEnveloppe ? colors.danger : colors.muted }}>
                {bloqueParEnveloppe
                  ? `Les dossiers marqués « validé » dépassent l'enveloppe de ${formatFCFA(excedent)} F. Rejetez-en, ou retirez-les de la file depuis l'onglet « Déposer » pour les garder disponibles pour une prochaine séance.`
                  : 'Le total des dossiers validés ne peut pas dépasser l\'enveloppe. Les dossiers en difficulté et les demandes exceptionnelles ne la consomment pas.'}
              </p>
            </Card>
          )}

          <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
            <SectionTitle>{totalPoints} point{totalPoints > 1 ? 's' : ''} à l'ordre du jour</SectionTitle>

            {agenda.credits.map((c) => (
              <AgendaRow
                key={`credit:${c.id}`}
                titre={`${c.client} · ${c.id}`}
                sousTitre={`${c.job_title ?? c.employer ?? '—'} · ${formatFCFA(c.amount)} F sur ${c.duration_months} mois${c.commission_note ? ` — ${c.commission_note}` : ''}`}
                badge="Nouveau crédit"
                decision={decisions[`credit:${c.id}`]}
                onDecision={(d) => setDecision('credit', c.id, d)}
                note={notes[`credit:${c.id}`] ?? ''}
                onNote={(v) => setNotes((prev) => ({ ...prev, [`credit:${c.id}`]: v }))}
                readOnly={!peutTenir}
                extra={can(role, 'commission.ajuster_dossier')
                  ? <AjustementDossier credit={c} onAjuste={load} />
                  : null}
              />
            ))}
            {agenda.points.map((p) => (
              <AgendaRow
                key={`item:${p.id}`}
                titre={p.client ? `${p.client} — ${p.titre}` : p.titre}
                sousTitre={p.note}
                badge={p.type === 'dossier_difficulte' ? 'Dossier en difficulté' : 'Demande exceptionnelle'}
                badgeTone={p.type === 'dossier_difficulte' ? 'danger' : 'gold'}
                decision={decisions[`item:${p.id}`]}
                onDecision={(d) => setDecision('item', p.id, d)}
                note={notes[`item:${p.id}`] ?? ''}
                onNote={(v) => setNotes((prev) => ({ ...prev, [`item:${p.id}`]: v }))}
                readOnly={!peutTenir}
              />
            ))}
          </Card>

          {peutTenir && (
            <button
              onClick={submit}
              disabled={decidedCount < totalPoints || busy || bloqueParEnveloppe}
              style={{
                ...actionBtn(colors.forest, '#fff'),
                opacity: decidedCount < totalPoints || bloqueParEnveloppe ? 0.5 : 1,
                cursor: decidedCount < totalPoints || bloqueParEnveloppe ? 'not-allowed' : 'pointer',
              }}
            >
              <ListChecks size={13} />
              {busy ? 'Enregistrement…'
                : bloqueParEnveloppe ? `Enveloppe dépassée de ${formatFCFA(excedent)} F`
                : `Clore la séance (${decidedCount}/${totalPoints} tranchés)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * AJUSTER UN DOSSIER EN SÉANCE
 *
 * « Je vais modifier les montants demain en commission. »
 *
 * Un comité qui ne peut pas réduire un montant n'a que deux réponses :
 * tout accorder ou tout refuser. Avec une enveloppe plafonnée, cela
 * conduirait à écarter de bons dossiers faute de place. Ici, on ajuste.
 *
 * Le montant demandé par le client reste affiché à côté de celui
 * retenu : sans ça, un dossier réduit devient indistinguable d'un
 * dossier accordé tel quel.
 */
function AjustementDossier({ credit, onAjuste }) {
  const [ouvert, setOuvert] = useState(false);
  const [montant, setMontant] = useState('');
  const [duree, setDuree] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');

  const ajuste = credit.amount_initial !== null && credit.amount_initial !== undefined;

  const enregistrer = async () => {
    setBusy(true);
    setErreur('');
    try {
      await ajusterDossierCommission(credit.id, {
        montant: montant === '' ? undefined : Number(montant),
        duree: duree === '' ? undefined : Number(duree),
        motif: motif.trim() || undefined,
      });
      setOuvert(false);
      setMontant(''); setDuree(''); setMotif('');
      onAjuste();
    } catch (e) {
      setErreur(e.message ?? "L'ajustement n'a pas pu être enregistré.");
    } finally {
      setBusy(false);
    }
  };

  const rienAChanger = montant === '' && duree === '';

  return (
    <div style={{ marginTop: 6 }}>
      {ajuste && (
        <p style={{ margin: '0 0 6px', fontSize: 11, color: colors.goldDark, fontFamily: fonts.body }}>
          <Badge tone="gold">ajusté</Badge>{' '}
          Demandé : <strong style={{ fontFamily: fonts.mono }}>{formatFCFA(credit.amount_initial)} F</strong>
          {' '}sur {credit.duration_initial} mois
          {credit.ajuste_par_nom ? ` — ajusté par ${credit.ajuste_par_nom}` : ''}
        </p>
      )}

      {erreur && (
        <p style={{ margin: '0 0 6px', fontSize: 11.5, color: colors.danger, fontFamily: fonts.body }}>{erreur}</p>
      )}

      {!ouvert ? (
        <button
          onClick={() => { setOuvert(true); setMontant(String(credit.amount)); setDuree(String(credit.duration_months)); }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8,
            border: `1px solid ${colors.line}`, background: 'transparent', color: colors.forestLight,
            fontSize: 11, fontFamily: fonts.body, cursor: 'pointer',
          }}
        >
          <Pencil size={11} /> Modifier le montant ou la durée
        </button>
      ) : (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap',
          padding: '10px 12px', borderRadius: 9, background: colors.bg, border: `1px solid ${colors.line}`,
        }}>
          <div style={{ width: 130 }}>
            <label style={label}>Montant</label>
            <input
              style={{ ...input, fontFamily: fonts.mono }}
              inputMode="numeric" autoFocus
              value={montant}
              onChange={(e) => setMontant(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <div style={{ width: 90 }}>
            <label style={label}>Durée (mois)</label>
            <input
              style={{ ...input, fontFamily: fonts.mono }}
              inputMode="numeric"
              value={duree}
              onChange={(e) => setDuree(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={label}>Motif (optionnel)</label>
            <input
              style={input}
              placeholder="Ex. : capacité de remboursement"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
          </div>
          <button onClick={enregistrer} disabled={busy || rienAChanger} style={actionBtn(colors.forest, '#fff')}>
            {busy ? 'Enregistrement…' : 'Appliquer'}
          </button>
          <button onClick={() => { setOuvert(false); setErreur(''); }} disabled={busy} style={actionBtn('transparent', colors.muted)}>
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

function AgendaRow({ titre, sousTitre, badge, badgeTone = 'neutral', decision, onDecision, note, onNote, readOnly, extra }) {
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
          {extra}
        </div>
        {!readOnly && (
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
        )}
      </div>
      {decision && !readOnly && (
        <input
          style={input} placeholder="Note de décision (optionnel)"
          value={note} onChange={(e) => onNote(e.target.value)}
        />
      )}
    </div>
  );
}
