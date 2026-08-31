import React, { useState, useEffect } from 'react';
import {
  Inbox, ShieldCheck, MessageCircle, Check, X, Eye, Filter, Send, CalendarClock, Gavel,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, SectionTitle } from '../components/UI';
import {
  validateLevel1, rejectCredit, sendAdvisorReply,
  fetchDoubleValidationQueue, doubleValidateCredit,
  fetchCreditRequests, fetchCreditDetail, fetchConversations, fetchConversationMessages,
} from '../api/adminApi';
import OperationsView from './OperationsView';

export default function OperatorView() {
  const [tab, setTab] = useState('demandes');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const checkUnread = () => {
      fetchConversations()
        .then((list) => setUnreadCount(list.reduce((sum, c) => sum + (c.non_lus ?? 0), 0)))
        .catch(() => {});
    };
    checkUnread();
    // Vérifie toutes les 30 secondes : assez réactif pour qu'un
    // gestionnaire remarque vite un nouveau message, sans solliciter
    // le serveur en continu.
    const interval = setInterval(checkUnread, 30000);
    return () => clearInterval(interval);
  }, [tab]);

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: 'demandes', label: 'Demandes entrantes', icon: Inbox },
          { key: 'double-validation', label: 'Double validation', icon: Gavel },
          { key: 'verification', label: 'Vérification client', icon: ShieldCheck },
          { key: 'operations', label: 'Opérations mensuelles', icon: CalendarClock },
          { key: 'messagerie', label: 'Messagerie', icon: MessageCircle, badge: unreadCount },
        ]}
      />
      {tab === 'demandes' && <IncomingRequests />}
      {tab === 'double-validation' && <DoubleValidation />}
      {tab === 'verification' && <ClientVerification />}
      {tab === 'operations' && <OperationsView />}
      {tab === 'messagerie' && <Messaging />}
    </div>
  );
}

/**
 * Double validation post-commission : l'opérateur revalide un dossier
 * déjà tranché par le comité de crédit, avant que le directeur ne
 * donne l'approbation finale qui débloque réellement les fonds.
 */
function DoubleValidation() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const queue = await fetchDoubleValidationQueue();
      setPending(queue);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handle = async (r) => {
    setBusy(r.id);
    try {
      await doubleValidateCredit(r.id);
      setToast(`${r.id} revalidé — en attente de l'approbation finale du directeur.`);
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
          {loading ? 'Chargement…' : `${pending.length} dossier${pending.length > 1 ? 's' : ''} validé${pending.length > 1 ? 's' : ''} par le comité, à revalider`}
        </SectionTitle>
        {!loading && pending.length === 0 && (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucun dossier en attente de double validation.
          </p>
        )}
        {pending.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
              padding: '16px 20px', borderBottom: `1px solid ${colors.line}`,
              opacity: busy === r.id ? 0.5 : 1,
            }}
          >
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>{r.client}</p>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                {r.poste} · Réf. {r.id} · validé par le comité
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
                {formatFCFA(r.montant)} F
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>{r.duree} mois</p>
            </div>
            <button
              onClick={() => handle(r)}
              disabled={busy === r.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9,
                border: 'none', background: colors.forest, color: '#fff', fontSize: 12, fontWeight: 600,
                fontFamily: fonts.body, cursor: 'pointer',
              }}
            >
              <Check size={12} /> Revalider
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}

function IncomingRequests({ onSelect }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = () => {
    setLoading(true);
    fetchCreditRequests('en_verification').then(setRequests).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handle = async (id, action) => {
    setBusy(id);
    try {
      if (action === 'valider') await validateLevel1(id);
      else await rejectCredit(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <SectionTitle
        right={
          <button style={iconBtnStyle}>
            <Filter size={13} /> Filtrer
          </button>
        }
      >
        {loading ? 'Chargement…' : `${requests.length} demande${requests.length > 1 ? 's' : ''} à traiter`}
      </SectionTitle>

      {!loading && requests.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucune demande en attente. Tout est traité.
        </p>
      )}

      {requests.map((r) => (
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
              {r.job_title} · Réf. {r.reference} · {new Date(r.created_at).toLocaleDateString('fr-FR')}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>
              {formatFCFA(r.amount)} F
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {r.duration_months} mois
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handle(r.id, 'valider')}
              disabled={busy === r.id}
              title="Valider niveau 1"
              style={roundBtn(colors.forestPale)}
            >
              <Check size={16} color={colors.forestLight} />
            </button>
            <button
              onClick={() => handle(r.id, 'rejeter')}
              disabled={busy === r.id}
              title="Rejeter"
              style={roundBtn(colors.dangerPale)}
            >
              <X size={16} color={colors.danger} />
            </button>
            <button onClick={() => onSelect?.(r.id)} title="Consulter le dossier" style={roundBtn(colors.bg)}>
              <Eye size={15} color={colors.muted} />
            </button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function ClientVerification() {
  const [reference, setReference] = useState('');
  const [dossier, setDossier] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState([]);

  useEffect(() => {
    fetchCreditRequests('en_verification').then(setPending).catch(() => {});
  }, []);

  const load = async (creditId) => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchCreditDetail(creditId);
      setDossier(result.credit);
      setDocuments(result.documents ?? []);
    } catch (e) {
      setError(e.message ?? 'Dossier introuvable.');
    } finally {
      setLoading(false);
    }
  };

  if (!dossier) {
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>Choisir un dossier à vérifier</SectionTitle>
        {pending.length === 0 && (
          <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
            Aucun dossier en attente de vérification.
          </p>
        )}
        {pending.map((r) => (
          <button
            key={r.id}
            onClick={() => load(r.id)}
            style={{
              display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
              gap: 16, padding: '14px 20px', border: 'none', borderBottom: `1px solid ${colors.line}`,
              background: 'transparent', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>{r.client}</span>
            <span style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Réf. {r.reference}</span>
          </button>
        ))}
        {error && <p style={{ padding: 16, color: colors.danger, fontSize: 12, fontFamily: fonts.body }}>{error}</p>}
      </Card>
    );
  }

  const complete = documents.length > 0 && documents.every((d) => d.status === 'verifiee');

  return (
    <Card style={{ padding: 20 }}>
      <p style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        Dossier en cours — {dossier.client} · Réf. {dossier.reference}
      </p>

      {documents.length === 0 ? (
        <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, marginBottom: 20 }}>
          Aucune pièce justificative enregistrée pour ce dossier.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: colors.bg, borderRadius: 10, padding: '10px 14px',
              }}
            >
              <span style={{ fontSize: 12, color: colors.ink, fontFamily: fonts.body }}>{doc.kind}</span>
              <Badge tone={doc.status === 'verifiee' ? 'neutral' : doc.status === 'refusee' ? 'danger' : 'gold'}>
                {doc.status === 'verifiee' ? 'Vérifiée' : doc.status === 'refusee' ? 'Refusée' : 'En attente'}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {!complete && documents.length > 0 && (
        <p style={{ fontSize: 11, color: colors.danger, fontFamily: fonts.body, marginBottom: 14 }}>
          Une pièce manque ou reste à vérifier : la validation de premier niveau reste possible depuis
          l'onglet « Demandes entrantes », mais le gestionnaire en sera informé.
        </p>
      )}

      <button
        onClick={() => setDossier(null)}
        style={{
          padding: '11px 20px', borderRadius: 12, border: `1px solid ${colors.line}`,
          background: 'transparent', color: colors.muted, fontSize: 12, fontWeight: 600,
          fontFamily: fonts.body, cursor: 'pointer',
        }}
      >
        Choisir un autre dossier
      </button>
    </Card>
  );
}

function Messaging() {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetchConversations().then((list) => {
      setConversations(list);
      if (list.length > 0) selectConversation(list[0]);
    }).finally(() => setLoading(false));
  }, []);

  const selectConversation = async (conv) => {
    setActive(conv);
    const history = await fetchConversationMessages(conv.id);
    setMessages(history);
  };

  const send = async () => {
    if (!draft.trim() || !active) return;
    const result = await sendAdvisorReply(active.id, draft);
    setMessages((prev) => [...prev, result.message ?? result]);
    setDraft('');
    setSent(true);
    setTimeout(() => setSent(false), 2500);
  };

  if (loading) {
    return <Card style={{ padding: 40, textAlign: 'center' }}>Chargement…</Card>;
  }

  if (!active) {
    return (
      <Card style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>Aucune conversation pour le moment.</p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      <Card style={{ padding: 0, overflow: 'hidden', height: 'fit-content' }}>
        <SectionTitle>Conversations</SectionTitle>
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => selectConversation(c)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              textAlign: 'left',
              padding: '12px 16px',
              border: 'none',
              borderBottom: `1px solid ${colors.line}`,
              background: active.id === c.id ? colors.forestPale : 'transparent',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                background: colors.forestPale,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 600,
                color: colors.forestLight,
                fontFamily: fonts.body,
                flexShrink: 0,
              }}
            >
              {c.client[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                {c.client}
              </p>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: 11,
                  color: colors.muted,
                  fontFamily: fonts.body,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.dernier_message}
              </p>
            </div>
            {c.non_lus > 0 && <Badge tone="gold">{c.non_lus}</Badge>}
          </button>
        ))}
      </Card>

      <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', minHeight: 320 }}>
        <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          {active.client}
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
          {active.client_number}
        </p>

        <div
          style={{
            flex: 1,
            background: colors.bg,
            borderRadius: 12,
            padding: 16,
            marginBottom: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowY: 'auto',
          }}
        >
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                background: colors.card,
                border: `1px solid ${colors.line}`,
                borderRadius: 14,
                borderBottomLeftRadius: 4,
                padding: '10px 14px',
                maxWidth: '75%',
                fontSize: 13,
                color: colors.ink,
                fontFamily: fonts.body,
                alignSelf: 'flex-start',
              }}
            >
              {m.body}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Répondre au client…"
            style={{
              flex: 1,
              padding: '11px 16px',
              borderRadius: 999,
              border: `1px solid ${colors.line}`,
              fontSize: 13,
              fontFamily: fonts.body,
              outline: 'none',
            }}
          />
          <button onClick={send} style={roundBtn(colors.forest, 40)}>
            <Send size={15} color="#fff" />
          </button>
        </div>
        {sent && (
          <p style={{ margin: '10px 0 0', fontSize: 11, color: colors.forestLight, fontFamily: fonts.body }}>
            Message envoyé — une notification push part vers l'application du client.
          </p>
        )}
      </Card>
    </div>
  );
}

const roundBtn = (bg, size = 34) => ({
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

const iconBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  background: 'transparent',
  color: colors.muted,
  fontSize: 12,
  fontFamily: fonts.body,
  cursor: 'pointer',
};
