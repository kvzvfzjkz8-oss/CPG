import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest, persistSession, clearSession, hasStoredSession } from '../api/client';

const AuthContext = createContext(null);

/**
 * Session réelle du back-office. Remplace l'ancien sélecteur de rôle
 * de démonstration : le rôle vient désormais du serveur, associé au
 * compte qui s'est réellement connecté — un opérateur ne peut plus se
 * transformer en directeur d'un simple clic.
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('checking'); // checking | signedOut | signedIn
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      if (!hasStoredSession()) {
        setStatus('signedOut');
        return;
      }
      try {
        const me = await apiRequest('/v1/auth/moi');
        setUser(me);
        setStatus('signedIn');
      } catch {
        clearSession();
        setStatus('signedOut');
      }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await apiRequest('/v1/auth/connexion-agent', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    });
    persistSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setUser({
      id: data.user.id,
      fullName: data.user.fullName,
      role: data.user.role,
      permissions: data.user.permissions,
    });
    setStatus('signedIn');
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/v1/auth/deconnexion', { method: 'POST' });
    } catch {
      // La déconnexion locale doit réussir même si l'appel réseau échoue.
    }
    clearSession();
    setUser(null);
    setStatus('signedOut');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé à l’intérieur de AuthProvider.');
  return ctx;
}
