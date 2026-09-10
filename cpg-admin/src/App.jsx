import React, { useState, useEffect, useRef } from 'react';
import { GitCommit, Search, Bell, LogOut, KeyRound, X, MessageSquare, Send } from 'lucide-react';
import { colors, fonts } from './theme';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from './auth/roles';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { changerMonMotDePasse, modifierMonProfil, fetchMessagesInternes, envoyerMessageInterne } from './api/adminApi';
import LoginView from './views/LoginView';
import OperatorView from './views/OperatorView';
import SupervisorView from './views/SupervisorView';
import CaissierView from './views/CaissierView';

function initialsOf(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const role = user?.role;
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showMessagerie, setShowMessagerie] = useState(false);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: colors.bg }}>
      {/* ── Barre latérale ─────────────────────────────────────── */}
      <aside
        style={{
          width: 244,
          flexShrink: 0,
          background: colors.forest,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '24px 16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', marginBottom: 32 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: colors.gold,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GitCommit size={17} color={colors.forest} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: fonts.display }}>
                CPG Admin
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 10, color: colors.onForest, fontFamily: fonts.body }}>
                Back-office
              </p>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, color: colors.onForest, fontFamily: fonts.body }}>
              Connecté en tant que
            </p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: fonts.body }}>
              {user?.fullName}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.gold, fontFamily: fonts.body }}>
              {ROLE_LABELS[role] ?? role}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: '#fff',
              fontFamily: fonts.body,
            }}
          >
            {initialsOf(user?.fullName)}
          </div>
          <span style={{ flex: 1, fontSize: 11, color: '#fff', fontFamily: fonts.body }}>{user?.fullName}</span>
          <button
            onClick={() => setShowMessagerie(true)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            title="Messagerie interne — équipe"
          >
            <MessageSquare size={14} color={colors.onForest} />
          </button>
          <button
            onClick={() => setShowPasswordModal(true)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            title="Sécurité — changer mon mot de passe"
          >
            <KeyRound size={14} color={colors.onForest} />
          </button>
          <button
            onClick={logout}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            title="Déconnexion"
          >
            <LogOut size={14} color={colors.onForest} />
          </button>
        </div>
      </aside>

      {showPasswordModal && <PasswordModal onClose={() => setShowPasswordModal(false)} />}
      {showMessagerie && <MessagerieInterneModal onClose={() => setShowMessagerie(false)} currentUserId={user?.id} />}

      {/* ── Zone principale ────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            height: 68,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 32px',
            background: colors.card,
            borderBottom: `1px solid ${colors.line}`,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: colors.ink, fontFamily: fonts.display }}>
              Espace {ROLE_LABELS[role] ?? role}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {ROLE_DESCRIPTIONS[role] ?? ''}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={14} color={colors.muted} style={{ position: 'absolute', left: 12 }} />
              <input
                placeholder="Rechercher un client, une référence…"
                style={{
                  padding: '9px 12px 9px 34px',
                  width: 260,
                  borderRadius: 10,
                  border: `1px solid ${colors.line}`,
                  fontSize: 12,
                  fontFamily: fonts.body,
                  outline: 'none',
                }}
              />
            </div>
            <Bell size={17} color={colors.ink} />
          </div>
        </header>

        <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
          {role === ROLES.OPERATEUR && <OperatorView />}
          {role === ROLES.CAISSIER && <CaissierView />}
          {role !== ROLES.OPERATEUR && role !== ROLES.CAISSIER && <SupervisorView role={role} />}
        </div>
      </main>
    </div>
  );
}

function MessagerieInterneModal({ onClose, currentUserId }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const listRef = useRef(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  };

  const load = (premierChargement) => {
    fetchMessagesInternes()
      .then((data) => {
        setMessages(data);
        if (premierChargement) scrollToBottom();
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 8000);
    return () => clearInterval(interval);
  }, []);

  const envoyer = async (e) => {
    e.preventDefault();
    const body = texte.trim();
    if (!body) return;
    setEnvoi(true);
    setTexte('');
    try {
      const message = await envoyerMessageInterne(body);
      setMessages((prev) => [...prev, message]);
      scrollToBottom();
    } finally {
      setEnvoi(false);
    }
  };

  const roleLabel = { operateur: 'Opérateur', superviseur: 'Gestionnaire', directeur: 'Directeur', caissier: 'Caissière' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(11,61,46,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, width: 440, maxWidth: '92vw', height: 560, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${colors.line}` }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: colors.ink, fontFamily: fonts.display }}>
            Messagerie interne
          </p>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={18} color={colors.muted} />
          </button>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, textAlign: 'center' }}>Chargement…</p>
          ) : messages.length === 0 ? (
            <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, textAlign: 'center' }}>
              Aucun message pour le moment — écrivez au reste de l'équipe.
            </p>
          ) : (
            messages.map((m) => {
              const soi = m.sender_id === currentUserId;
              return (
                <div key={m.id} style={{ alignSelf: soi ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                  {!soi && (
                    <p style={{ margin: '0 0 3px 2px', fontSize: 10, fontWeight: 600, color: colors.forestLight, fontFamily: fonts.body }}>
                      {m.expediteur} · {roleLabel[m.expediteur_role] ?? m.expediteur_role}
                    </p>
                  )}
                  <div style={{
                    background: soi ? colors.forest : colors.bg,
                    color: soi ? '#fff' : colors.ink,
                    borderRadius: 12,
                    padding: '9px 13px',
                    fontSize: 13,
                    fontFamily: fonts.body,
                    wordBreak: 'break-word',
                  }}>
                    {m.body}
                  </div>
                  <p style={{ margin: '3px 2px 0', fontSize: 9, color: colors.muted, fontFamily: fonts.body, textAlign: soi ? 'right' : 'left' }}>
                    {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={envoyer} style={{ display: 'flex', gap: 8, padding: 14, borderTop: `1px solid ${colors.line}` }}>
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder="Écrire à l'équipe…"
            style={{ flex: 1, padding: '10px 12px', borderRadius: 20, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body }}
          />
          <button
            type="submit"
            disabled={envoi || !texte.trim()}
            style={{
              width: 38, height: 38, borderRadius: '50%', border: 'none', background: colors.forest,
              color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: !texte.trim() ? 0.5 : 1,
            }}
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

function PasswordModal({ onClose }) {
  const [modalTab, setModalTab] = useState('motdepasse');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(11,61,46,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, padding: 24, width: 380, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: colors.ink, fontFamily: fonts.display }}>
            Sécurité
          </p>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={18} color={colors.muted} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {[
            { key: 'motdepasse', label: 'Mot de passe' },
            { key: 'profil', label: 'Nom et email' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setModalTab(t.key)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${modalTab === t.key ? colors.forest : colors.line}`,
                background: modalTab === t.key ? colors.forest : 'transparent',
                color: modalTab === t.key ? '#fff' : colors.muted,
                fontFamily: fonts.body,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {modalTab === 'motdepasse' ? <ChangerMotDePasseForm onClose={onClose} /> : <ModifierProfilForm onClose={onClose} />}
      </div>
    </div>
  );
}

function ChangerMotDePasseForm({ onClose }) {
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (nouveau.length < 12) {
      setError('Le nouveau mot de passe doit contenir au moins 12 caractères.');
      return;
    }
    if (nouveau !== confirmation) {
      setError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setBusy(true);
    try {
      await changerMonMotDePasse(ancien, nouveau);
      setSuccess(true);
    } catch (err) {
      setError(err.message ?? 'Le changement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
        {success ? (
          <div>
            <p style={{ fontSize: 13, color: colors.forestLight, fontFamily: fonts.body, marginBottom: 16 }}>
              Mot de passe changé avec succès. Vos autres sessions ouvertes ont été déconnectées par sécurité.
            </p>
            <button
              onClick={onClose}
              style={{
                width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
                background: colors.forest, color: '#fff', fontSize: 13, fontWeight: 600,
                fontFamily: fonts.body, cursor: 'pointer',
              }}
            >
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Mot de passe actuel</label>
            <input
              type="password" required autoFocus value={ancien}
              onChange={(e) => setAncien(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, margin: '6px 0 14px' }}
            />

            <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Nouveau mot de passe (12 caractères minimum)</label>
            <input
              type="password" required value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, margin: '6px 0 14px' }}
            />

            <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Confirmer le nouveau mot de passe</label>
            <input
              type="password" required value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, margin: '6px 0 16px' }}
            />

            {error && (
              <p style={{ fontSize: 12, color: colors.danger, fontFamily: fonts.body, marginBottom: 14 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
                background: colors.forest, color: '#fff', fontSize: 13, fontWeight: 600,
                fontFamily: fonts.body, cursor: 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Changement…' : 'Changer mon mot de passe'}
            </button>
          </form>
        )}
    </>
  );
}

function ModifierProfilForm({ onClose }) {
  const { refreshUser } = useAuth();
  const [motDePasse, setMotDePasse] = useState('');
  const [nomComplet, setNomComplet] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!nomComplet.trim() && !email.trim()) {
      setError('Renseignez au moins le nom ou l\'email à modifier.');
      return;
    }
    setBusy(true);
    try {
      const result = await modifierMonProfil(motDePasse, {
        nomComplet: nomComplet.trim() || undefined,
        email: email.trim() || undefined,
      });
      refreshUser?.(result);
      setSuccess(true);
    } catch (err) {
      setError(err.message ?? 'La modification a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {success ? (
        <div>
          <p style={{ fontSize: 13, color: colors.forestLight, fontFamily: fonts.body, marginBottom: 16 }}>
            Profil mis à jour avec succès.
          </p>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
              background: colors.forest, color: '#fff', fontSize: 13, fontWeight: 600,
              fontFamily: fonts.body, cursor: 'pointer',
            }}
          >
            Fermer
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Nouveau nom complet</label>
          <input
            value={nomComplet} onChange={(e) => setNomComplet(e.target.value)}
            placeholder="Laisser vide pour ne pas changer"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, margin: '6px 0 14px' }}
          />

          <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Nouvel email de connexion</label>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Laisser vide pour ne pas changer"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, margin: '6px 0 14px' }}
          />

          <label style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>Confirmez avec votre mot de passe actuel</label>
          <input
            type="password" required autoFocus value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, margin: '6px 0 16px' }}
          />

          {error && (
            <p style={{ fontSize: 12, color: colors.danger, fontFamily: fonts.body, marginBottom: 14 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
              background: colors.forest, color: '#fff', fontSize: 13, fontWeight: 600,
              fontFamily: fonts.body, cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Modification…' : 'Enregistrer les modifications'}
          </button>
        </form>
      )}
    </>
  );
}


function Root() {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: colors.forest,
      }}>
        <p style={{ color: colors.onForest, fontFamily: fonts.body, fontSize: 13 }}>Chargement…</p>
      </div>
    );
  }

  if (status === 'signedIn') {
    return <AuthenticatedApp />;
  }

  return <LoginView />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
