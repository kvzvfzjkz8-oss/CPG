import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loadStoredSession, clearSession, forgetPhone, ApiError } from '../api/client';
import { loginWithPin, activateAccount, fetchMe, logout as apiLogout } from '../api/clientApi';

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

      if (!hasSession) {
        // Pas de session valide : le numéro mémorisé d'un essai
        // précédent (même une tentative ratée) ne doit pas rester
        // affiché indéfiniment sans possibilité de le changer. On
        // repart d'un écran de connexion propre.
        setKnownPhone(null);
        await forgetPhone();
        setStatus('signedOut');
        return;
      }

      setKnownPhone(phone ?? null);
      try {
        const me = await fetchMe();
        setUser(me);
        setStatus('signedIn');
      } catch {
        // Jeton de rafraîchissement expiré ou révoqué : retour à
        // l'écran de connexion, sans faire planter l'app.
        await clearSession();
        setKnownPhone(null);
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

  const activate = useCallback(async (phone, clientNumber, nouveauPin) => {
    const me = await activateAccount(phone, clientNumber, nouveauPin);
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
    await forgetPhone();
    setUser(null);
    setKnownPhone(null);
    setStatus('signedOut');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, knownPhone, login, activate, logout }}>
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
