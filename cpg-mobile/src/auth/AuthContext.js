import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loadStoredSession, clearSession, ApiError } from '../api/client';
import { loginWithPin, fetchMe, logout as apiLogout } from '../api/clientApi';

const AuthContext = createContext(null);

/**
 * Session du client. Distingue trois états au démarrage :
 *   - `checking`   : on regarde s'il y a une session enregistrée
 *   - pas de session : direction l'écran de connexion (téléphone + PIN)
 *   - session valide : profil chargé, direction l'app
 *
 * Le jeton d'accès étant de courte durée (15 min), on ne fait pas
 * confiance à sa seule présence : `fetchMe()` sert de vérification
 * réelle, et le client API rafraîchit tout seul si besoin (voir
 * src/api/client.js).
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('checking'); // checking | signedOut | signedIn
  const [user, setUser] = useState(null);
  const [knownPhone, setKnownPhone] = useState(null);

  useEffect(() => {
    (async () => {
      const { hasSession, phone } = await loadStoredSession();
      setKnownPhone(phone ?? null);

      if (!hasSession) {
        setStatus('signedOut');
        return;
      }
      try {
        const me = await fetchMe();
        setUser(me);
        setStatus('signedIn');
      } catch {
        // Jeton de rafraîchissement expiré ou révoqué : retour à
        // l'écran de connexion, sans faire planter l'app.
        await clearSession();
        setStatus('signedOut');
      }
    })();
  }, []);

  const login = useCallback(async (phone, pin) => {
    const me = await loginWithPin(phone, pin);
    setUser(me);
    setKnownPhone(phone);
    setStatus('signedIn');
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // La déconnexion locale doit réussir même si l'appel réseau
      // échoue (pas de réseau, jeton déjà expiré…).
    }
    await clearSession();
    setUser(null);
    setStatus('signedOut');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, knownPhone, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé à l’intérieur de AuthProvider.');
  return ctx;
}

export { ApiError };
