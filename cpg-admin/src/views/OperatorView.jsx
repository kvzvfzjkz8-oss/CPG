import React, { useState, useEffect } from 'react';
import {
  Inbox, ShieldCheck, MessageCircle, Check, X, Eye, Filter, Send, CalendarClock, Gavel,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, Tabs, SectionTitle } from '../components/UI';
import { creditRequests, conversations, STATUTS } from '../data/mockData';
import {
  validateLevel1, rejectCredit, sendAdvisorReply,
  fetchDoubleValidationQueue, doubleValidateCredit,
} from '../api/adminApi';
import OperationsView from './OperationsView';

export default function OperatorView() {
  const [tab, setTab] = useState('demandes');

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
          { key: 'messagerie', label: 'Messagerie', icon: MessageCircle },
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

function IncomingRequests() {
  const [requests, setRequests] = useState(
    creditRequests.filter((r) => r.statut === STATUTS.EN_VERIFICATION)
  );
  const [busy, setBusy] = useState(null);

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
        {requests.length} demande{requests.length > 1 ? 's' : ''} à traiter
      </SectionTitle>

      {requests.length === 0 && (
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
              {r.poste} · Réf. {r.id} · {r.date}
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
            <button title="Consulter le dossier" style={roundBtn(colors.bg)}>
              <Eye size={15} color={colors.muted} />
            </button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function ClientVerification() {
  const dossier = creditRequests.find((r) => r.pieces);
  const entries = Object.entries(dossier.pieces);
  const complete = entries.every(([, v]) => v === 'ok');

  return (
    <Card style={{ padding: 20 }}>
      <p style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
        Dossier en cours — {dossier.client} · Réf. {dossier.id}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {entries.map(([piece, status]) => (
          <div
            key={piece}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: colors.bg,
              borderRadius: 10,
              padding: '10px 14px',
            }}
          >
            <span style={{ fontSize: 12, color: colors.ink, fontFamily: fonts.body }}>{piece}</span>
            <Badge tone={status === 'ok' ? 'neutral' : 'danger'}>
              {status === 'ok' ? 'Vérifiée' : 'En attente'}
            </Badge>
          </div>
        ))}
      </div>

      {!complete && (
        <p style={{ fontSize: 11, color: colors.danger, fontFamily: fonts.body, marginBottom: 14 }}>
          Une pièce manque : la validation de premier niveau reste possible, mais le gestionnaire en
          sera informé.
        </p>
      )}

      <button
        style={{
          padding: '11px 20px',
          borderRadius: 12,
          border: 'none',
          background: colors.forest,
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: fonts.body,
          cursor: 'pointer',
        }}
      >
        Valider premier niveau
      </button>
    </Card>
  );
}

function Messaging() {
  const [active, setActive] = useState(conversations[0]);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!draft.trim()) return;
    await sendAdvisorReply(active.id, draft);
    setDraft('');
    setSent(true);
    setTimeout(() => setSent(false), 2500);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      <Card style={{ padding: 0, overflow: 'hidden', height: 'fit-content' }}>
        <SectionTitle>Conversations</SectionTitle>
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c)}
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
                {c.last}
              </p>
            </div>
            {c.unread > 0 && <Badge tone="gold">{c.unread}</Badge>}
          </button>
        ))}
      </Card>

      <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', minHeight: 320 }}>
        <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
          {active.client}
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
          Dernier message il y a {active.ago}
        </p>

        <div
          style={{
            flex: 1,
            background: colors.bg,
            borderRadius: 12,
            padding: 16,
            marginBottom: 14,
          }}
        >
          <div
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
            }}
          >
            {active.last}
          </div>
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
