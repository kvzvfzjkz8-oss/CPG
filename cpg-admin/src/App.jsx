import React, { useState } from 'react';
import { GitCommit, Search, Bell, LogOut, KeyRound, X } from 'lucide-react';
import { colors, fonts } from './theme';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from './auth/roles';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { changerMonMotDePasse } from './api/adminApi';
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

function PasswordModal({ onClose }) {
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
            Sécurité — mon mot de passe
          </p>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={18} color={colors.muted} />
          </button>
        </div>

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
      </div>
    </div>
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
