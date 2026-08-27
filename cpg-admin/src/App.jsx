import React, { useState } from 'react';
import { GitCommit, Search, Bell, LogOut } from 'lucide-react';
import { colors, fonts } from './theme';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, DEMO_ACCOUNTS } from './auth/roles';
import OperatorView from './views/OperatorView';
import SupervisorView from './views/SupervisorView';

export default function App() {
  const [role, setRole] = useState(ROLES.OPERATEUR);
  const account = DEMO_ACCOUNTS[role];

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
            <p style={{ margin: '0 0 8px', fontSize: 10, color: colors.onForest, fontFamily: fonts.body }}>
              Poste connecté
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.values(ROLES).map((r) => {
                const active = role === r;
                return (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    style={{
                      textAlign: 'left',
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: active ? colors.gold : 'transparent',
                      color: active ? colors.forest : '#fff',
                      fontSize: 12,
                      fontWeight: 500,
                      fontFamily: fonts.body,
                      cursor: 'pointer',
                    }}
                  >
                    {r === ROLES.OPERATEUR ? 'Opérateur de crédit' : r === ROLES.DIRECTEUR ? 'Directeur' : 'Gestionnaire / Superviseur'}
                  </button>
                );
              })}
            </div>
          </div>

          <p style={{ margin: 0, padding: '0 8px', fontSize: 10, lineHeight: 1.6, color: '#8FB09D', fontFamily: fonts.body }}>
            Démonstration : basculez de poste pour voir l'interface se compartimenter selon le rôle.
          </p>
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
            {account.initials}
          </div>
          <span style={{ flex: 1, fontSize: 11, color: '#fff', fontFamily: fonts.body }}>{account.name}</span>
          <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }} title="Déconnexion">
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
              Espace {ROLE_LABELS[role]}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {ROLE_DESCRIPTIONS[role]}
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
          {role === ROLES.OPERATEUR ? <OperatorView /> : <SupervisorView role={role} />}
        </div>
      </main>
    </div>
  );
}
