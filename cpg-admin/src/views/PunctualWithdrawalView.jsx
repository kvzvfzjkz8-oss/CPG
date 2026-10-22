/**
 * ─────────────────────────────────────────────────────────────────────
 *  OPÉRATIONS PONCTUELLES SUR LE COMPTE D'UN CLIENT
 * ─────────────────────────────────────────────────────────────────────
 *
 * Deux besoins, un seul écran, une seule règle :
 *
 *   • RETRAIT PONCTUEL — débiter un compte en dehors de tout circuit
 *     prévu : récupérer un trop-perçu de paie, appliquer une décision
 *     de la direction, ou faire remettre une somme au guichet.
 *
 *   • RATTRAPAGE DE FRAIS — prélever les frais de tenue ou les agios
 *     qu'un passage automatique du 25 a manqués : un agent crédité
 *     après cette date, ou créé entre deux passages. La caisse l'a
 *     signalé plusieurs fois.
 *
 * Dans les deux cas l'opératrice DEMANDE seulement : rien ne bouge
 * avant la validation du directeur. Le motif est obligatoire — un
 * mouvement sans raison écrite est ingérable trois semaines plus tard.
 *
 * Différence essentielle entre les deux : sur un rattrapage de frais,
 * le montant n'est PAS saisi. Il est calculé depuis le barème en
 * vigueur, par le même code que le prélèvement automatique. Une
 * opératrice ne peut pas inventer un frais.
 */
import React, { useState, useEffect } from 'react';
import {
  Search, AlertTriangle, Check, Building2, HandCoins, Receipt, Percent, Banknote,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from '../components/UI';
import {
  rechercherClientsPaie, fetchCaissieresPourRetrait, demanderRetraitPonctuel,
  apercuFraisPonctuel, demanderFraisPonctuel,
} from '../api/adminApi';

const input = {
  width: '100%', padding: '9px 12px', borderRadius: 9,
  border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body,
};
const label = {
  display: 'block', fontSize: 11, color: colors.muted,
  fontFamily: fonts.body, marginBottom: 5,
};

const moisCourant = () => new Date().toISOString().slice(0, 7);

const OPERATIONS = [
  {
    k: 'retrait', t: 'Retrait sur le solde', i: Banknote,
    d: 'Débiter un compte : trop-perçu, décision de la direction, ou remise au guichet.',
  },
  {
    k: 'frais_tenue', t: 'Frais de tenue', i: Receipt,
    d: 'Rattraper les frais mensuels qu’un passage automatique a manqués.',
  },
  {
    k: 'agios', t: 'Agios', i: Percent,
    d: 'Rattraper les agios dus sur un solde resté débiteur.',
  },
];

export default function PunctualWithdrawalView() {
  const [operation, setOperation] = useState('retrait');
  const [recherche, setRecherche] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [client, setClient] = useState(null);
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');
  const [destination, setDestination] = useState('cpg');
  const [caissieres, setCaissieres] = useState([]);
  const [caissierId, setCaissierId] = useState('');
  const [periode, setPeriode] = useState(moisCourant());
  const [apercu, setApercu] = useState(null);
  const [apercuErreur, setApercuErreur] = useState('');
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');
  const [confirme, setConfirme] = useState(null);

  const estFrais = operation !== 'retrait';

  useEffect(() => {
    fetchCaissieresPourRetrait()
      .then((r) => setCaissieres(r.caissieres ?? []))
      .catch(() => setCaissieres([]));
  }, []);

  useEffect(() => {
    const q = recherche.trim();
    if (q.length < 2 || client) { setSuggestions([]); return undefined; }
    let annule = false;
    const t = setTimeout(() => {
      rechercherClientsPaie(q)
        .then((r) => { if (!annule) setSuggestions(r.resultats ?? []); })
        .catch(() => { if (!annule) setSuggestions([]); });
    }, 250);
    return () => { annule = true; clearTimeout(t); };
  }, [recherche, client]);

  // Le montant d'un frais vient du barème, pas de la saisie : dès que
  // le client et le mois sont connus, on demande au serveur ce qui
  // serait prélevé — et s'il l'a déjà été.
  useEffect(() => {
    if (!estFrais || !client || !/^\d{4}-\d{2}$/.test(periode)) {
      setApercu(null); setApercuErreur('');
      return undefined;
    }
    let annule = false;
    setApercu(null);
    setApercuErreur('');
    apercuFraisPonctuel({ clientId: client.id, nature: operation, periode })
      .then((r) => { if (!annule) setApercu(r); })
      .catch((e) => { if (!annule) setApercuErreur(e.message ?? 'Calcul impossible.'); });
    return () => { annule = true; };
  }, [estFrais, operation, client, periode]);

  const valide = estFrais
    ? Boolean(client) && Boolean(apercu) && apercu.montant > 0
      && !apercu.dejaPreleve && motif.trim().length >= 5
    : Boolean(client) && Number(montant) >= 500 && motif.trim().length >= 5
      && (destination === 'cpg' || caissierId);

  const envoyer = async () => {
    setBusy(true);
    setErreur('');
    try {
      const r = estFrais
        ? await demanderFraisPonctuel({
          clientId: client.id, nature: operation, periode, motif: motif.trim(),
        })
        : await demanderRetraitPonctuel({
          clientId: client.id,
          montant: Number(montant),
          motif: motif.trim(),
          destination,
          caissierId: destination === 'client' ? caissierId : undefined,
        });
      setConfirme({ ...r, estFrais, nature: operation, periode });
    } catch (e) {
      setErreur(e.message ?? "La demande n'a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  };

  const recommencer = () => {
    setConfirme(null); setClient(null); setRecherche('');
    setMontant(''); setMotif(''); setDestination('cpg'); setCaissierId('');
    setPeriode(moisCourant()); setApercu(null); setApercuErreur('');
    setErreur('');
  };

  if (confirme) {
    return (
      <div>
        <SectionTitle>Opération ponctuelle</SectionTitle>
        <Card style={{ borderColor: colors.forestLight }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Check size={18} color={colors.forestLight} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.forest, fontFamily: fonts.body }}>
                Demande transmise au directeur
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
                {formatFCFA(confirme.montant)} F sur le compte de {confirme.client} —{' '}
                {confirme.estFrais
                  ? `${confirme.nature === 'agios' ? 'agios' : 'frais de tenue'} du mois ${confirme.periode}`
                  : confirme.destination === 'cpg' ? 'récupération par CPG' : 'remise au client au guichet'}
                .
                <br />
                <strong>Rien n'est prélevé tant que le directeur n'a pas validé.</strong>
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                Motif : « {confirme.motif} »
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={recommencer}
            style={{
              marginTop: 14, padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
              border: `1px solid ${colors.line}`, background: colors.card,
              fontSize: 12, fontFamily: fonts.body, color: colors.forestLight,
            }}
          >
            Faire une autre opération
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Opération ponctuelle sur le compte d'un client</SectionTitle>

      <Card style={{ padding: 20 }}>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Votre demande part au directeur :
          <strong> rien n'est débité tant qu'il n'a pas validé.</strong>
        </p>

        {erreur && (
          <div style={{
            background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 10,
            padding: '10px 14px', marginBottom: 16, fontSize: 12, color: colors.danger, fontFamily: fonts.body,
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} /> {erreur}
          </div>
        )}

        {/* ── Nature de l'opération ───────────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          <label style={label}>Que voulez-vous faire ?</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {OPERATIONS.map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => { setOperation(o.k); setErreur(''); }}
                style={{
                  flex: '1 1 200px', textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${operation === o.k ? colors.forestLight : colors.line}`,
                  background: operation === o.k ? colors.forestPale : colors.card,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                  <o.i size={14} color={operation === o.k ? colors.forestLight : colors.muted} />
                  <span style={{
                    fontSize: 12, fontFamily: fonts.body,
                    fontWeight: operation === o.k ? 600 : 400,
                    color: operation === o.k ? colors.forest : colors.ink,
                  }}>
                    {o.t}
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.body }}>{o.d}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Client ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16, position: 'relative' }}>
          <label style={label}>Client</label>
          {client ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              border: `1px solid ${colors.forestLight}`, borderRadius: 9, background: colors.forestPale,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: colors.forest, fontFamily: fonts.body }}>{client.nom}</div>
                <div style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.mono }}>
                  {client.client_number}{client.employer ? ` · ${client.employer}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setClient(null); setRecherche(''); }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: colors.muted, fontSize: 12 }}
              >
                changer
              </button>
            </div>
          ) : (
            <>
              <Search size={14} color={colors.muted} style={{ position: 'absolute', left: 11, top: 30 }} />
              <input
                style={{ ...input, paddingLeft: 32 }}
                placeholder="Nom, numéro client ou téléphone"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              {suggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
                  background: colors.card, border: `1px solid ${colors.line}`, borderRadius: 10,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.10)', maxHeight: 230, overflowY: 'auto',
                }}>
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setClient(c); setSuggestions([]); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px',
                        border: 'none', borderBottom: `1px solid ${colors.line}`, background: 'none',
                        cursor: 'pointer', fontFamily: fonts.body, fontSize: 12,
                      }}
                    >
                      <span style={{ color: colors.ink }}>{c.nom}</span>
                      <span style={{ color: colors.muted, fontSize: 10, fontFamily: fonts.mono }}>
                        {'  '}{c.client_number}{c.employer ? ` · ${c.employer}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Rattrapage de frais : mois + montant calculé ───────── */}
        {estFrais ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Mois à rattraper</label>
              <input
                type="month"
                style={{ ...input, maxWidth: 200, fontFamily: fonts.mono }}
                value={periode}
                max={moisCourant()}
                onChange={(e) => setPeriode(e.target.value)}
              />
              <p style={{ margin: '5px 0 0', fontSize: 10.5, color: colors.muted, fontFamily: fonts.body }}>
                Un mois déjà écoulé est permis : c'est tout l'intérêt du rattrapage.
              </p>
            </div>

            {apercuErreur && (
              <div style={{
                background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 12, color: colors.danger,
                fontFamily: fonts.body, display: 'flex', gap: 8, alignItems: 'center',
              }}>
                <AlertTriangle size={15} style={{ flexShrink: 0 }} /> {apercuErreur}
              </div>
            )}

            {client && apercu && (
              <div style={{
                marginBottom: 16, padding: '12px 14px', borderRadius: 10,
                border: `1px solid ${apercu.dejaPreleve || apercu.montant <= 0 ? colors.gold : colors.forestLight}`,
                background: apercu.dejaPreleve || apercu.montant <= 0 ? colors.goldPale : colors.forestPale,
              }}>
                {apercu.dejaPreleve ? (
                  <p style={{ margin: 0, fontSize: 12, color: colors.goldDark, fontFamily: fonts.body }}>
                    <strong>Déjà prélevé.</strong> {client.nom} a payé{' '}
                    {formatFCFA(apercu.dejaPreleve.montant)} F pour {periode}, le{' '}
                    {new Date(apercu.dejaPreleve.le).toLocaleDateString('fr-FR')}. Rien à rattraper —
                    un second prélèvement est impossible.
                  </p>
                ) : apercu.montant <= 0 ? (
                  <p style={{ margin: 0, fontSize: 12, color: colors.goldDark, fontFamily: fonts.body }}>
                    <strong>Rien à prélever.</strong>{' '}
                    {operation === 'agios'
                      ? "Le compte n'est pas resté débiteur sur ce mois, aucun agio n'est dû."
                      : 'Le barème donne un montant nul.'}
                  </p>
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: colors.forest, fontFamily: fonts.body }}>
                      À prélever :{' '}
                      <strong style={{ fontFamily: fonts.mono, fontSize: 14 }}>
                        {formatFCFA(apercu.montant)} F
                      </strong>{' '}
                      — barème « {apercu.bareme} »
                      {apercu.detail?.joursDebiteurs !== undefined
                        && `, ${apercu.detail.joursDebiteurs} jour(s) débiteur(s)`}
                    </p>
                    <p style={{ margin: '5px 0 0', fontSize: 10.5, color: colors.muted, fontFamily: fonts.body }}>
                      Montant calculé depuis le barème en vigueur, non modifiable. Solde actuel du client :{' '}
                      <strong style={{ fontFamily: fonts.mono }}>{formatFCFA(apercu.soldeClient)} F</strong>
                      {Number(apercu.soldeClient) < apercu.montant
                        && ' — le prélèvement le mettra au rouge, ce qui est normal pour un frais.'}
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* ── Retrait : montant et destination ───────────────── */}
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Montant</label>
              <input
                style={{ ...input, fontFamily: fonts.mono }}
                placeholder="0"
                inputMode="numeric"
                value={montant}
                onChange={(e) => setMontant(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={label}>Destination de la somme</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { k: 'cpg', t: 'Récupération par CPG', d: "La somme rejoint la caisse principale. Aucun guichet n'est impliqué.", i: Building2 },
                  { k: 'client', t: 'Remise au client', d: 'La caissière désignée lui remet les espèces au guichet.', i: HandCoins },
                ].map((o) => (
                  <button
                    key={o.k}
                    type="button"
                    onClick={() => setDestination(o.k)}
                    style={{
                      flex: '1 1 230px', textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: 'pointer',
                      border: `1.5px solid ${destination === o.k ? colors.forestLight : colors.line}`,
                      background: destination === o.k ? colors.forestPale : colors.card,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                      <o.i size={14} color={destination === o.k ? colors.forestLight : colors.muted} />
                      <span style={{
                        fontSize: 12, fontFamily: fonts.body,
                        fontWeight: destination === o.k ? 600 : 400,
                        color: destination === o.k ? colors.forest : colors.ink,
                      }}>
                        {o.t}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.body }}>{o.d}</div>
                  </button>
                ))}
              </div>
            </div>

            {destination === 'client' && (
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Caissière qui servira la somme</label>
                <select
                  style={input}
                  value={caissierId}
                  onChange={(e) => setCaissierId(e.target.value)}
                >
                  <option value="">Choisir une caissière…</option>
                  {caissieres.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {/* ── Motif, commun aux deux ─────────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          <label style={label}>Motif — obligatoire</label>
          <input
            style={input}
            placeholder={estFrais
              ? 'Ex. : non prélevé par le logiciel, agent crédité le 28'
              : 'Ex. : récupération trop-perçu salaire septembre'}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <p style={{ margin: '5px 0 0', fontSize: 10.5, color: colors.muted, fontFamily: fonts.body }}>
            Il apparaîtra au journal du client et sous les yeux du directeur.
          </p>
        </div>

        <button
          type="button"
          onClick={envoyer}
          disabled={!valide || busy}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10,
            border: 'none', background: colors.forest, color: '#fff', fontSize: 12.5,
            fontFamily: fonts.body, fontWeight: 600,
            cursor: valide && !busy ? 'pointer' : 'not-allowed', opacity: valide && !busy ? 1 : 0.5,
          }}
        >
          {busy ? 'Envoi…' : 'Soumettre au directeur'}
        </button>

        {client && (estFrais ? apercu?.montant > 0 && !apercu.dejaPreleve : Number(montant) > 0) && (
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: colors.muted, fontFamily: fonts.body }}>
            <Badge tone="gold">à valider</Badge>{' '}
            {formatFCFA(estFrais ? apercu.montant : Number(montant))} F seront prélevés sur le compte de{' '}
            {client.nom} après accord du directeur.
          </p>
        )}
      </Card>
    </div>
  );
}
