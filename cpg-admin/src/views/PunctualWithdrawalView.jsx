/**
 * ─────────────────────────────────────────────────────────────────────
 *  RETRAIT PONCTUEL SUR LE COMPTE D'UN CLIENT
 * ─────────────────────────────────────────────────────────────────────
 *
 * Débiter un compte en dehors de tout circuit prévu : récupérer un
 * trop-perçu de paie, appliquer une décision de la direction, ou faire
 * remettre une somme au guichet. Cela ne se faisait jusqu'ici que par
 * intervention directe en base.
 *
 * L'opératrice DEMANDE seulement — rien ne bouge avant la validation du
 * directeur, comme pour un retrait de caisse. Le motif est obligatoire :
 * un débit sans raison écrite est ingérable trois semaines plus tard.
 */
import React, { useState, useEffect } from 'react';
import { Search, AlertTriangle, Check, Building2, HandCoins } from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from '../components/UI';
import {
  rechercherClientsPaie, fetchCaissieresPourRetrait, demanderRetraitPonctuel,
} from '../api/adminApi';

const input = {
  width: '100%', padding: '9px 12px', borderRadius: 9,
  border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body,
};
const label = {
  display: 'block', fontSize: 11, color: colors.muted,
  fontFamily: fonts.body, marginBottom: 5,
};

export default function PunctualWithdrawalView() {
  const [recherche, setRecherche] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [client, setClient] = useState(null);
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');
  const [destination, setDestination] = useState('cpg');
  const [caissieres, setCaissieres] = useState([]);
  const [caissierId, setCaissierId] = useState('');
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');
  const [confirme, setConfirme] = useState(null);

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

  const valide = client
    && Number(montant) >= 500
    && motif.trim().length >= 5
    && (destination === 'cpg' || caissierId);

  const envoyer = async () => {
    setBusy(true);
    setErreur('');
    try {
      const r = await demanderRetraitPonctuel({
        clientId: client.id,
        montant: Number(montant),
        motif: motif.trim(),
        destination,
        caissierId: destination === 'client' ? caissierId : undefined,
      });
      setConfirme(r);
    } catch (e) {
      setErreur(e.message ?? "La demande n'a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  };

  const recommencer = () => {
    setConfirme(null); setClient(null); setRecherche('');
    setMontant(''); setMotif(''); setDestination('cpg'); setCaissierId('');
    setErreur('');
  };

  if (confirme) {
    return (
      <div>
        <SectionTitle>Retrait ponctuel</SectionTitle>
        <Card style={{ borderColor: colors.forestLight }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Check size={18} color={colors.forestLight} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.forest, fontFamily: fonts.body }}>
                Demande transmise au directeur
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
                {formatFCFA(confirme.montant)} F sur le compte de {confirme.client} —{' '}
                {confirme.destination === 'cpg' ? 'récupération par CPG' : 'remise au client au guichet'}.
                <br />
                <strong>Rien n'est débité tant que le directeur n'a pas validé.</strong>
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
            Faire un autre retrait
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Retrait ponctuel sur le compte d'un client</SectionTitle>

      <Card style={{ padding: 20 }}>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Débiter un compte en dehors des circuits habituels. Votre demande part au directeur :
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

        <div style={{ marginBottom: 18 }}>
          <label style={label}>Motif — obligatoire</label>
          <input
            style={input}
            placeholder="Ex. : récupération trop-perçu salaire septembre"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <p style={{ margin: '5px 0 0', fontSize: 10.5, color: colors.muted, fontFamily: fonts.body }}>
            Il apparaîtra au journal du client, au brouillard de caisse et sous les yeux du directeur.
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

        {client && Number(montant) > 0 && (
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: colors.muted, fontFamily: fonts.body }}>
            <Badge tone="gold">à valider</Badge>{' '}
            {formatFCFA(Number(montant))} F seront débités de {client.nom} après accord du directeur.
          </p>
        )}
      </Card>
    </div>
  );
}
