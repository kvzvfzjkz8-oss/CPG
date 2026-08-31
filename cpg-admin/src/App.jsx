import React from 'react';
import { GitCommit, Search, Bell, LogOut } from 'lucide-react';
import { colors, fonts } from './theme';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from './auth/roles';
import { AuthProvider, useAuth } from './auth/AuthContext';
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
            onClick={logout}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            title="Déconnexion"
          >
            <LogOut size={14} color={colors.onForest} />
          </button>
        </div>
      </aside>

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
