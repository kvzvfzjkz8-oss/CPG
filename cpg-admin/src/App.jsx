import React, { useState, useEffect, useRef } from 'react';
import { GitCommit, Search, Bell, LogOut, KeyRound, X, MessageSquare, Send, Users } from 'lucide-react';
import { colors, fonts } from './theme';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from './auth/roles';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { changerMonMotDePasse, modifierMonProfil, fetchMessagesInternes, envoyerMessageInterne, fetchPersonnel, fetchNotifications } from './api/adminApi';
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
  // Onglet réclamé depuis la cloche de notifications. Objet et non
  // simple chaîne : recliquer la même tâche doit rouvrir l'onglet, donc
  // il faut une nouvelle identité à chaque clic.
  const [ongletDemande, setOngletDemande] = useState(null);
  // Compteur de messages non lus, remonte par la cloche : l'icone de
  // messagerie de la barre laterale est l'entree dediee aux messages,
  // elle doit porter le chiffre elle aussi.
  const [messagesNonLus, setMessagesNonLus] = useState(0);

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
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              position: 'relative', display: 'flex',
            }}
            title={messagesNonLus > 0
              ? `${messagesNonLus} message${messagesNonLus > 1 ? 's' : ''} non lu${messagesNonLus > 1 ? 's' : ''}`
              : 'Messagerie interne — équipe'}
          >
            <MessageSquare size={14} color={messagesNonLus > 0 ? colors.gold : colors.onForest} />
            {messagesNonLus > 0 && (
              <span
                className="cpg-anim-pastille"
                style={{
                  position: 'absolute', top: -6, right: -7, minWidth: 15, height: 15, borderRadius: 8,
                  background: colors.danger, color: '#fff', fontSize: 9, fontWeight: 700,
                  fontFamily: fonts.body, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 3px', border: `2px solid ${colors.forest}`,
                  animation: 'cpg-pastille-pulse 1.9s ease-in-out infinite',
                }}
              >
                {messagesNonLus > 9 ? '9+' : messagesNonLus}
              </span>
            )}
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
            <NotificationBell
              onOuvrirMessagerie={() => setShowMessagerie(true)}
              onOuvrirOnglet={(cle) => setOngletDemande({ cle })}
              onMessagesNonLus={setMessagesNonLus}
            />
          </div>
        </header>

        <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
          {role === ROLES.OPERATEUR && <OperatorView />}
          {role === ROLES.CAISSIER && <CaissierView />}
          {role !== ROLES.OPERATEUR && role !== ROLES.CAISSIER && (
            <SupervisorView role={role} ongletDemande={ongletDemande} />
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Quelle file de tâches mène à quel onglet. Sans cette table, la cloche
 * annonce « 3 retraits à valider » et laisse chercher l'onglet à la
 * main — ce qui faisait attendre le guichet. Une tâche absente d'ici
 * reste affichée, simplement non cliquable.
 */
const ONGLET_PAR_TACHE = {
  seance_a_tenir: 'commission',
  approbation_finale: 'validation',
  corrections_echeances: 'corrections',
  suppressions_credits: 'suppressions-credit',
  suppressions_items: 'suppressions-commission',
  caisse_operations: 'caisse',
};

/**
 * LE SON D'ARRIVÉE
 *
 * Deux notes brèves, synthétisées à la volée : pas de fichier audio à
 * charger, donc rien qui dépende du réseau ni d'un format accepté par
 * le navigateur.
 *
 * Une contrainte à connaître : les navigateurs refusent de jouer du son
 * avant que l'utilisateur ait interagi avec la page. Le contexte audio
 * est donc créé au premier clic, pas au chargement — sans cela, le
 * premier son serait avalé en silence et on croirait à une panne.
 */
let contexteAudio = null;

function preparerSon() {
  if (contexteAudio) return;
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctx) return;
  try {
    contexteAudio = new Ctx();
  } catch {
    contexteAudio = null;
  }
}

function jouerCarillon() {
  if (!contexteAudio) return;
  try {
    if (contexteAudio.state === 'suspended') contexteAudio.resume();
    const maintenant = contexteAudio.currentTime;
    // Deux notes montantes : reconnaissable sans être strident, et
    // assez court pour ne pas gêner si plusieurs arrivent d'affilée.
    [
      { frequence: 880, debut: 0, duree: 0.16 },
      { frequence: 1175, debut: 0.13, duree: 0.22 },
    ].forEach(({ frequence, debut, duree }) => {
      const oscillateur = contexteAudio.createOscillator();
      const gain = contexteAudio.createGain();
      oscillateur.type = 'sine';
      oscillateur.frequency.value = frequence;
      // Attaque et extinction douces : un créneau brut « claque ».
      gain.gain.setValueAtTime(0, maintenant + debut);
      gain.gain.linearRampToValueAtTime(0.16, maintenant + debut + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, maintenant + debut + duree);
      oscillateur.connect(gain);
      gain.connect(contexteAudio.destination);
      oscillateur.start(maintenant + debut);
      oscillateur.stop(maintenant + debut + duree + 0.02);
    });
  } catch {
    // Un son qui ne part pas ne doit jamais casser l'écran.
  }
}

/**
 * Cloche de notifications — à la connexion et ensuite à intervalle
 * régulier, affiche les tâches en attente propres au rôle et le
 * nombre de messages internes non lus. Cliquer sur un message ouvre
 * directement la messagerie, cliquer sur une tâche ouvre son onglet.
 */
function NotificationBell({ onOuvrirMessagerie, onOuvrirOnglet, onMessagesNonLus }) {
  const [notifications, setNotifications] = useState(null);
  const [open, setOpen] = useState(false);
  // Vrai pendant quelques secondes après l'arrivée d'une nouveauté :
  // c'est ce qui déclenche la secousse, le halo et le bandeau.
  const [nouveaute, setNouveaute] = useState(null);
  const ref = useRef(null);
  // Dernier total connu. Une ref et non un état : le comparer ne doit
  // pas provoquer de rendu supplémentaire.
  const totalPrecedent = useRef(null);

  const load = () => {
    fetchNotifications().then(setNotifications).catch(() => {});
  };

  useEffect(() => {
    load();
    // Assez fréquent pour qu'une tâche fraîchement déposée ou un
    // message qui vient d'arriver soit vu sans avoir à recharger la
    // page, sans pour autant solliciter le serveur en continu.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Le navigateur refuse de jouer un son avant toute interaction. On
  // prépare donc le contexte audio au premier clic de la session, une
  // seule fois — sinon le premier carillon partirait dans le vide.
  useEffect(() => {
    const amorcer = () => preparerSon();
    document.addEventListener('pointerdown', amorcer, { once: true });
    document.addEventListener('keydown', amorcer, { once: true });
    return () => {
      document.removeEventListener('pointerdown', amorcer);
      document.removeEventListener('keydown', amorcer);
    };
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const totalTaches = notifications?.totalTaches ?? 0;
  const messagesEnAttente = notifications?.messagesEnAttente ?? 0;
  const total = totalTaches + messagesEnAttente;

  // ─── Détection d'une nouveauté ────────────────────────────────────
  //
  // On ne signale que les HAUSSES, et jamais le premier chargement :
  // sonner à chaque connexion pour des tâches déjà connues apprendrait
  // à ignorer le son. Le compteur qui redescend ne sonne pas non plus —
  // c'est le signe qu'on vient de traiter quelque chose.
  useEffect(() => {
    if (notifications === null) return;
    const avant = totalPrecedent.current;
    totalPrecedent.current = total;
    if (avant === null || total <= avant) return;

    jouerCarillon();
    setNouveaute({ nombre: total - avant, le: Date.now() });
  }, [total, notifications]);

  // Le bandeau et les animations s'effacent d'eux-mêmes : une alerte
  // qui reste à l'écran indéfiniment devient du décor.
  useEffect(() => {
    if (!nouveaute) return undefined;
    const t = setTimeout(() => setNouveaute(null), 14000);
    return () => clearTimeout(t);
  }, [nouveaute]);

  useEffect(() => { onMessagesNonLus?.(messagesEnAttente); }, [messagesEnAttente]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le compteur dans le titre de l'onglet du navigateur. C'est le seul
  // signal qui porte quand la fenêtre n'est pas au premier plan — et
  // c'est le cas le plus fréquent : on travaille ailleurs en attendant.
  useEffect(() => {
    const base = 'CPG — Back-office';
    document.title = total > 0 ? `(${total}) ${base}` : base;
    return () => { document.title = base; };
  }, [total]);

  /** Ouvre ce qui attend : le plus urgent d'abord. */
  const ouvrirLePlusUrgent = () => {
    setNouveaute(null);
    const premiere = (notifications?.taches ?? []).find((t) => ONGLET_PAR_TACHE[t.cle]);
    if (premiere && onOuvrirOnglet) {
      onOuvrirOnglet(ONGLET_PAR_TACHE[premiere.cle]);
      return;
    }
    if (messagesEnAttente > 0) { onOuvrirMessagerie?.(); return; }
    setOpen(true);
  };

  const resume = [
    totalTaches > 0 ? `${totalTaches} tâche${totalTaches > 1 ? 's' : ''} à traiter` : null,
    messagesEnAttente > 0 ? `${messagesEnAttente} message${messagesEnAttente > 1 ? 's' : ''} non lu${messagesEnAttente > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* ── Bandeau d'arrivée ──────────────────────────────────────
          C'est lui qui pousse au clic : il descend sous l'en-tête, dit
          ce qui attend, et ouvre directement le bon écran. Il s'effface
          seul au bout de quatorze secondes — une alerte permanente
          devient du décor qu'on ne lit plus. */}
      {nouveaute && (
        <div
          role="status"
          className="cpg-anim-bandeau"
          style={{
            position: 'fixed', top: 78, right: 28, zIndex: 120, maxWidth: 380,
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '13px 16px', borderRadius: 12,
            background: colors.forest, color: '#fff',
            boxShadow: '0 10px 30px rgba(11,61,46,0.30)',
            animation: 'cpg-bandeau-entre 260ms ease-out',
          }}
        >
          <span style={{
            position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: 15, background: 'rgba(255,255,255,0.14)', flexShrink: 0,
          }}>
            <Bell size={15} color="#fff" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, fontFamily: fonts.body }}>
              {nouveaute.nombre === 1 ? 'Une nouvelle tâche vous attend' : `${nouveaute.nombre} nouvelles tâches vous attendent`}
            </p>
            {resume && (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.78)', fontFamily: fonts.body }}>
                {resume}
              </p>
            )}
          </div>
          <button
            onClick={ouvrirLePlusUrgent}
            style={{
              border: 'none', borderRadius: 9, padding: '7px 13px', cursor: 'pointer',
              background: colors.gold, color: colors.forest,
              fontSize: 11.5, fontWeight: 700, fontFamily: fonts.body, whiteSpace: 'nowrap',
            }}
          >
            Ouvrir
          </button>
          <button
            onClick={() => setNouveaute(null)}
            title="Masquer"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 2,
              color: 'rgba(255,255,255,0.6)', display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <button
        onClick={() => { setOpen((v) => !v); setNouveaute(null); if (!open) load(); }}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, position: 'relative' }}
        title={total > 0 ? resume : 'Notifications'}
      >
        {/* Halo qui s'écarte : la seule chose qui accroche vraiment le
            regard quand on fixe un tableau ailleurs sur l'écran. */}
        {nouveaute && (
          <span
            className="cpg-anim-halo"
            style={{
              position: 'absolute', top: -7, right: -8, width: 29, height: 29, borderRadius: 15,
              background: colors.danger, pointerEvents: 'none',
              animation: 'cpg-halo 1.5s ease-out 3',
            }}
          />
        )}
        <span
          className={nouveaute ? 'cpg-anim-cloche' : undefined}
          style={{
            display: 'flex',
            transformOrigin: '50% 10%',
            animation: nouveaute ? 'cpg-cloche-sonne 820ms ease-in-out 2' : undefined,
          }}
        >
          <Bell size={17} color={total > 0 ? colors.danger : colors.ink} />
        </span>
        {total > 0 && (
          <span
            className="cpg-anim-pastille"
            style={{
              position: 'absolute', top: -6, right: -7, minWidth: 17, height: 17, borderRadius: 9,
              background: colors.danger, color: '#fff', fontSize: 9.5, fontWeight: 700, fontFamily: fonts.body,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              border: `2px solid ${colors.card}`, boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
              animation: 'cpg-pastille-pulse 1.9s ease-in-out infinite',
            }}
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 28, right: 0, width: 300, maxHeight: 380, overflowY: 'auto',
          background: '#fff', borderRadius: 12, border: `1px solid ${colors.line}`,
          boxShadow: '0 8px 24px rgba(11,61,46,0.14)', zIndex: 50,
        }}>
          <p style={{ margin: 0, padding: '12px 16px', fontSize: 12, fontWeight: 600, color: colors.ink, fontFamily: fonts.body, borderBottom: `1px solid ${colors.line}` }}>
            Notifications
          </p>

          {messagesEnAttente > 0 && (
            <button
              onClick={() => { setOpen(false); onOuvrirMessagerie?.(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
                borderBottom: `1px solid ${colors.line}`,
              }}
            >
              <MessageSquare size={13} color={colors.forestLight} />
              <span style={{ fontSize: 12, color: colors.ink, fontFamily: fonts.body }}>
                {messagesEnAttente} message{messagesEnAttente > 1 ? 's' : ''} non lu{messagesEnAttente > 1 ? 's' : ''}
              </span>
            </button>
          )}

          {(notifications?.taches ?? []).map((t) => {
            const onglet = ONGLET_PAR_TACHE[t.cle];
            const contenu = (
              <>
                <span style={{ fontSize: 12, color: colors.ink, fontFamily: fonts.body, textAlign: 'left' }}>
                  {t.libelle}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: colors.gold, background: colors.goldPale,
                  borderRadius: 8, padding: '2px 7px', fontFamily: fonts.body,
                }}>
                  {t.nombre}
                </span>
              </>
            );
            const style = {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              width: '100%', padding: '10px 16px', borderBottom: `1px solid ${colors.line}`,
            };

            if (!onglet || !onOuvrirOnglet) {
              return <div key={t.cle} style={style}>{contenu}</div>;
            }
            return (
              <button
                key={t.cle}
                onClick={() => { setOpen(false); onOuvrirOnglet(onglet); }}
                style={{ ...style, border: 'none', borderBottom: `1px solid ${colors.line}`, background: 'transparent', cursor: 'pointer' }}
                title="Ouvrir"
              >
                {contenu}
              </button>
            );
          })}

          {total === 0 && (
            <p style={{ margin: 0, padding: '20px 16px', fontSize: 12, color: colors.muted, fontFamily: fonts.body, textAlign: 'center' }}>
              Rien en attente pour le moment.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MessagerieInterneModal({ onClose, currentUserId }) {
  const [personnel, setPersonnel] = useState([]);
  const [destinataire, setDestinataire] = useState(null); // null = canal d'équipe
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
    fetchMessagesInternes(destinataire?.id)
      .then((data) => {
        setMessages(data);
        if (premierChargement) scrollToBottom();
      })
      .finally(() => setLoading(false));
  };

  // Rafraîchit aussi la liste du personnel à chaque tour, pour que le
  // point vert de présence reste à jour sans que quiconque ait besoin
  // de rouvrir la messagerie.
  useEffect(() => {
    fetchPersonnel().then(setPersonnel);
    const presenceInterval = setInterval(() => fetchPersonnel().then(setPersonnel), 15000);
    return () => clearInterval(presenceInterval);
  }, []);

  useEffect(() => {
    setLoading(true);
    load(true);
    const interval = setInterval(() => load(false), 6000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinataire]);

  const envoyer = async (e) => {
    e.preventDefault();
    const body = texte.trim();
    if (!body) return;
    setEnvoi(true);
    setTexte('');
    try {
      const message = await envoyerMessageInterne(body, destinataire?.id);
      setMessages((prev) => [...prev, message]);
      scrollToBottom();
    } finally {
      setEnvoi(false);
    }
  };

  const roleLabel = { operateur: 'Opérateur', superviseur: 'Gestionnaire', directeur: 'Directeur', caissier: 'Caissière' };
  const initiales = (nom) => nom.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(11,61,46,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, width: 460, maxWidth: '92vw', height: 600, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px' }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: colors.ink, fontFamily: fonts.display }}>
            {destinataire ? destinataire.full_name : 'Messagerie interne'}
          </p>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={18} color={colors.muted} />
          </button>
        </div>

        {/* Sélecteur de contact : toute l'équipe, ou une personne précise */}
        <div style={{ display: 'flex', gap: 10, padding: '0 20px 14px', overflowX: 'auto', borderBottom: `1px solid ${colors.line}` }}>
          <button
            onClick={() => setDestinataire(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}
            title="Toute l'équipe"
          >
            <div style={{
              width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: !destinataire ? colors.forest : colors.forestPale,
              border: !destinataire ? `2px solid ${colors.gold}` : '2px solid transparent',
            }}>
              <Users size={17} color={!destinataire ? '#fff' : colors.forestLight} />
            </div>
            <span style={{ fontSize: 9, color: !destinataire ? colors.ink : colors.muted, fontFamily: fonts.body, fontWeight: !destinataire ? 600 : 400 }}>
              Équipe
            </span>
          </button>

          {personnel.map((p) => (
            <button
              key={p.id}
              onClick={() => setDestinataire(p)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}
              title={`${p.full_name}${p.en_ligne ? ' — en ligne' : ''}`}
            >
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: destinataire?.id === p.id ? colors.forest : colors.forestPale,
                  border: destinataire?.id === p.id ? `2px solid ${colors.gold}` : '2px solid transparent',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: destinataire?.id === p.id ? '#fff' : colors.forestLight, fontFamily: fonts.body }}>
                    {initiales(p.full_name)}
                  </span>
                </div>
                {p.en_ligne && (
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%',
                    background: '#3CB371', border: '2px solid #fff',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 9, color: destinataire?.id === p.id ? colors.ink : colors.muted, fontFamily: fonts.body, fontWeight: destinataire?.id === p.id ? 600 : 400, maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.full_name.split(' ')[0]}
              </span>
            </button>
          ))}
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, textAlign: 'center' }}>Chargement…</p>
          ) : messages.length === 0 ? (
            <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, textAlign: 'center' }}>
              {destinataire ? `Aucun message avec ${destinataire.full_name} pour le moment.` : "Aucun message pour le moment — écrivez au reste de l'équipe."}
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
            placeholder={destinataire ? `Écrire à ${destinataire.full_name.split(' ')[0]}…` : "Écrire à l'équipe…"}
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
