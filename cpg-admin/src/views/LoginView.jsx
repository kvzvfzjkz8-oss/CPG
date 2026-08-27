import React, { useState } from 'react';
import { GitCommit } from 'lucide-react';
import { colors, fonts } from '../theme';
import { useAuth } from '../auth/AuthContext';

const labelStyle = {
  display: 'block', fontSize: 10, fontWeight: 600, color: colors.muted,
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9,
  border: `1px solid ${colors.line}`, fontSize: 13, fontFamily: fonts.body, outline: 'none',
};

export default function LoginView() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message ?? 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: colors.forest, fontFamily: fonts.body,
    }}>
      <form onSubmit={submit} style={{
        background: '#fff', borderRadius: 18, padding: 36, width: 360,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, background: colors.gold,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <GitCommit size={18} color={colors.forest} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: colors.ink, fontFamily: fonts.display }}>
              CPG Admin
            </p>
            <p style={{ margin: 0, fontSize: 10, color: colors.muted }}>Back-office</p>
          </div>
        </div>

        <p style={{ margin: '20px 0 18px', fontSize: 12, color: colors.muted }}>
          Connectez-vous avec vos identifiants CPG.
        </p>

        {error ? (
          <div style={{
            background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 10,
            padding: '10px 12px', marginBottom: 14, fontSize: 12, color: colors.danger,
          }}>
            {error}
          </div>
        ) : null}

        <label style={labelStyle}>Email</label>
        <input
          style={inputStyle}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="prenom@cpg.ga"
          required
        />

        <label style={{ ...labelStyle, marginTop: 12 }}>Mot de passe</label>
        <input
          style={inputStyle}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 22, width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
            background: colors.forest, color: '#fff', fontSize: 13, fontWeight: 600,
            fontFamily: fonts.body, cursor: 'pointer', opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
