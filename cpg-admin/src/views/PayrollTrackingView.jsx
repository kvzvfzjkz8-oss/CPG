/**
 * ─────────────────────────────────────────────────────────────────────
 *  SUIVI DE LA PAIE — qui a été payé, et que leur doit-on encore
 * ─────────────────────────────────────────────────────────────────────
 *
 * Pendant une paie, trois questions reviennent sans arrêt, au guichet
 * comme à la direction : l'agent a-t-il été payé, combien a-t-il déjà
 * retiré, et combien la caisse lui doit-elle encore. Jusqu'ici il
 * fallait ouvrir chaque compte un par un.
 *
 * « Reste à payer » est le solde du compte, pas un calcul maison :
 * c'est exactement ce que l'agent peut venir réclamer au guichet. Les
 * échéances de crédit et les frais déjà prélevés en sont donc déduits
 * — annoncer un salaire brut au guichet, c'est promettre une somme qui
 * n'est plus disponible.
 *
 * Un compte à découvert est affiché en rouge mais compté comme zéro
 * dans les totaux : la caisse ne doit rien à un agent débiteur.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Wallet, Building2, RefreshCw, Users, HandCoins, CheckCheck, AlertTriangle, X, CalendarClock,
} from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from '../components/UI';
import { fetchSuiviPaie, fetchSuiviPaieClient } from '../api/adminApi';

const SANS_EMPLOYEUR = 'Sans employeur renseigné';

function formatMois(mois) {
  if (!mois) return '';
  const [annee, m] = mois.split('-');
  const d = new Date(Date.UTC(Number(annee), Number(m) - 1, 1));
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Les douze derniers mois, le plus récent en tête. */
function moisDisponibles() {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 12; i += 1) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function formatDateHeure(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const LIBELLE_TYPE = {
  salaire: 'Salaire versé',
  retrait: 'Retrait au guichet',
  depot: 'Dépôt',
  paiement_credit: 'Prélèvement de crédit',
  deblocage_credit: 'Déblocage de crédit',
  frais: 'Frais',
  ajustement: 'Ajustement',
  annulation: 'Annulation',
};

/**
 * Le detail d'un agent : ce qu'il a touche, ce qu'on lui a preleve, et
 * quand. Ouvert au clic sur sa ligne.
 */
function DetailAgent({ clientId, mois, onFermer }) {
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setD(null);
    setErreur(null);
    fetchSuiviPaieClient(clientId, mois)
      .then((r) => { if (!annule) setD(r); })
      .catch((e) => { if (!annule) setErreur(e.message); });
    return () => { annule = true; };
  }, [clientId, mois]);

  return (
    <Card style={{ marginBottom: 14, borderColor: colors.forestLight }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <CalendarClock size={16} color={colors.forestLight} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: fonts.display, fontSize: 14, color: colors.forest, fontWeight: 600 }}>
            {d ? d.client.nom : 'Chargement…'}
          </div>
          {d && (
            <div style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body, marginTop: 2 }}>
              {d.client.client_number} · {d.client.employer ?? SANS_EMPLOYEUR}
              {d.client.phone ? ` · ${d.client.phone}` : ''} · solde {formatFCFA(d.client.solde)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onFermer}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: colors.muted, padding: 2 }}
        >
          <X size={16} />
        </button>
      </div>

      {erreur && (
        <div style={{ color: colors.danger, fontSize: 12, fontFamily: fonts.body }}>{erreur}</div>
      )}

      {d && d.credits.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {d.credits.map((c) => (
            <div key={c.reference} style={{
              border: `1px solid ${colors.line}`, borderRadius: 9, padding: '7px 11px',
              fontSize: 11, fontFamily: fonts.body, color: colors.muted,
            }}>
              <span style={{ fontFamily: fonts.mono, color: colors.ink }}>{c.reference}</span>
              {' · '}{formatFCFA(c.montant)}
              {' · '}mensualité {formatFCFA(c.mensualite)}
              {' · '}
              {c.statut === 'solde'
                ? <span style={{ color: colors.forestLight }}>soldé</span>
                : `${c.echeances_restantes} échéance${c.echeances_restantes > 1 ? 's' : ''} à payer`}
            </div>
          ))}
        </div>
      )}

      {d && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: fonts.body }}>
            <thead>
              <tr style={{ color: colors.muted, textAlign: 'left' }}>
                <th style={{ padding: '7px 0', fontWeight: 500 }}>Date</th>
                <th style={{ padding: '7px 10px', fontWeight: 500 }}>Opération</th>
                <th style={{ padding: '7px 10px', fontWeight: 500, textAlign: 'right' }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {d.mouvements.length === 0 && (
                <tr><td colSpan={3} style={{ padding: '10px 0', color: colors.muted }}>
                  Aucun mouvement sur ce mois.
                </td></tr>
              )}
              {d.mouvements.map((m) => (
                <tr key={m.id} style={{ borderTop: `1px solid ${colors.line}` }}>
                  <td style={{ padding: '8px 0', fontFamily: fonts.mono, color: colors.muted, whiteSpace: 'nowrap' }}>
                    {formatDateHeure(m.created_at)}
                  </td>
                  <td style={{ padding: '8px 10px', color: m.extournee ? colors.muted : colors.ink }}>
                    <span style={{ textDecoration: m.extournee ? 'line-through' : 'none' }}>
                      {LIBELLE_TYPE[m.type] ?? m.type}
                    </span>
                    {m.reference && (
                      <span style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.mono }}> · {m.reference}</span>
                    )}
                    {m.extournee && <Badge tone="danger">annulée ensuite</Badge>}
                  </td>
                  <td style={{
                    padding: '8px 0', textAlign: 'right', fontFamily: fonts.mono, fontWeight: 600,
                    color: m.extournee ? colors.muted : Number(m.montant) >= 0 ? colors.forestLight : colors.ink,
                    textDecoration: m.extournee ? 'line-through' : 'none',
                  }}>
                    {Number(m.montant) >= 0 ? '+' : ''}{formatFCFA(m.montant)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Chiffre({ icone: Icone, libelle, valeur, detail, ton = 'neutre' }) {
  const teinte = ton === 'or' ? colors.goldDark : ton === 'danger' ? colors.danger : colors.forestLight;
  return (
    <Card style={{ flex: '1 1 180px', minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.muted, fontSize: 11, fontFamily: fonts.body }}>
        <Icone size={14} color={teinte} />
        {libelle}
      </div>
      <div style={{ fontSize: 22, fontFamily: fonts.display, fontWeight: 600, color: teinte, marginTop: 6 }}>
        {valeur}
      </div>
      {detail && (
        <div style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body, marginTop: 2 }}>{detail}</div>
      )}
    </Card>
  );
}

export default function PayrollTrackingView() {
  const listeMois = useMemo(moisDisponibles, []);
  const [mois, setMois] = useState(listeMois[0]);
  const [recherche, setRecherche] = useState('');
  // Deux lectures du meme mois : le detail agent par agent pour le
  // guichet, et le recapitulatif par entreprise pour la direction qui
  // veut savoir ce qui est sorti chez chaque partenaire.
  const [vue, setVue] = useState('agents');
  const [agentOuvert, setAgentOuvert] = useState(null);
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    // Laisser le temps de finir de taper avant d'interroger le serveur.
    const t = setTimeout(() => {
      fetchSuiviPaie({ mois, recherche })
        .then((d) => { if (!annule) { setDonnees(d); setChargement(false); } })
        .catch((e) => { if (!annule) { setErreur(e.message); setChargement(false); } });
    }, recherche ? 300 : 0);
    return () => { annule = true; clearTimeout(t); };
  }, [mois, recherche]);

  const groupes = useMemo(() => {
    if (!donnees) return [];
    const m = new Map();
    for (const a of donnees.agents) {
      const cle = a.employer ?? SANS_EMPLOYEUR;
      if (!m.has(cle)) m.set(cle, []);
      m.get(cle).push(a);
    }
    return [...m.entries()]
      .map(([employeur, agents]) => ({
        employeur,
        agents,
        salaire: agents.reduce((t, x) => t + x.salaire, 0),
        retire: agents.reduce((t, x) => t + x.retire, 0),
        preleve: agents.reduce((t, x) => t + x.preleve, 0),
        reste: agents.reduce((t, x) => t + Math.max(0, x.resteAPayer), 0),
        // Les comptes a decouvert ne se compensent pas avec ceux qui ont
        // encore de l'argent : la caisse doit les voir a part.
        debiteurs: agents.reduce((t, x) => t + Math.min(0, x.resteAPayer), 0),
        servis: agents.filter((x) => x.soldeTout).length,
      }))
      .sort((a, b) => b.salaire - a.salaire);
  }, [donnees]);

  const t = donnees?.totaux;

  return (
    <div>
      <SectionTitle
        right={(
          <button
            type="button"
            onClick={() => setRecherche((r) => r)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9,
              border: `1px solid ${colors.line}`, background: colors.card, color: colors.muted,
              fontSize: 12, fontFamily: fonts.body, cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} /> Actualiser
          </button>
        )}
      >
        Suivi de la paie — {formatMois(mois)}
      </SectionTitle>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={14} color={colors.muted} style={{ position: 'absolute', left: 11, top: 11 }} />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, entreprise ou numéro client"
            style={{
              width: '100%', padding: '9px 12px 9px 32px', borderRadius: 9,
              border: `1px solid ${colors.line}`, fontSize: 12, fontFamily: fonts.body,
            }}
          />
        </div>
        <select
          value={mois}
          onChange={(e) => setMois(e.target.value)}
          style={{
            padding: '9px 12px', borderRadius: 9, border: `1px solid ${colors.line}`,
            fontSize: 12, fontFamily: fonts.body, background: colors.card, color: colors.ink,
          }}
        >
          {listeMois.map((m) => <option key={m} value={m}>{formatMois(m)}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4, background: colors.bg, padding: 3, borderRadius: 10 }}>
          {[{ k: 'agents', l: 'Par agent' }, { k: 'entreprises', l: 'Par entreprise' }].map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setVue(o.k)}
              style={{
                padding: '7px 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 12, fontFamily: fonts.body,
                background: vue === o.k ? colors.card : 'transparent',
                color: vue === o.k ? colors.forest : colors.muted,
                fontWeight: vue === o.k ? 600 : 400,
              }}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {erreur && (
        <Card style={{ borderColor: colors.danger, background: colors.dangerPale, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: colors.danger, fontSize: 12, fontFamily: fonts.body }}>
            <AlertTriangle size={15} /> {erreur}
          </div>
        </Card>
      )}

      {chargement && !donnees && (
        <Card><div style={{ color: colors.muted, fontSize: 12, fontFamily: fonts.body }}>Chargement…</div></Card>
      )}

      {donnees && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <Chiffre icone={Users} libelle="Agents payés" valeur={t.agents}
              detail={`${t.soldesTout} entièrement servis`} />
            <Chiffre icone={Wallet} libelle="Salaires versés" valeur={formatFCFA(t.salaire)} ton="or" />
            <Chiffre icone={HandCoins} libelle="Déjà retiré" valeur={formatFCFA(t.retire)} />
            <Chiffre icone={CheckCheck} libelle="Prélevé sur crédits" valeur={formatFCFA(t.preleve)}
              detail={`dont ${formatFCFA(t.frais)} de frais`} />
            <Chiffre icone={Building2} libelle="Reste à payer" valeur={formatFCFA(t.resteAPayer)} ton="danger" />
          </div>

          {donnees.agents.length === 0 && (
            <Card>
              <div style={{ color: colors.muted, fontSize: 12, fontFamily: fonts.body }}>
                Aucun salaire versé sur cette période{recherche ? ' pour cette recherche' : ''}.
              </div>
            </Card>
          )}

          {agentOuvert && (
            <DetailAgent clientId={agentOuvert} mois={mois} onFermer={() => setAgentOuvert(null)} />
          )}

          {vue === 'entreprises' && donnees.agents.length > 0 && (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: fonts.body }}>
                  <thead>
                    <tr style={{ color: colors.muted, textAlign: 'right', background: colors.forestPale }}>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 500 }}>Entreprise</th>
                      <th style={{ padding: '10px', fontWeight: 500 }}>Agents</th>
                      <th style={{ padding: '10px', fontWeight: 500 }}>Salaires versés</th>
                      <th style={{ padding: '10px', fontWeight: 500 }}>Argent sorti</th>
                      <th style={{ padding: '10px', fontWeight: 500 }}>Prélevé</th>
                      <th style={{ padding: '10px', fontWeight: 500 }}>Soldes débiteurs</th>
                      <th style={{ padding: '10px 14px', fontWeight: 500 }}>Reste à payer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupes.map((g) => (
                      <tr key={g.employeur} style={{ borderTop: `1px solid ${colors.line}`, textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <Building2 size={14} color={colors.forestLight} style={{ flexShrink: 0 }} />
                            <span style={{ color: colors.ink }}>{g.employeur}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px', fontFamily: fonts.mono, color: colors.muted }}>
                          {g.agents.length}
                          {g.servis > 0 && (
                            <span style={{ fontSize: 10, color: colors.goldDark }}> · {g.servis} servi{g.servis > 1 ? 's' : ''}</span>
                          )}
                        </td>
                        <td style={{ padding: '10px', fontFamily: fonts.mono }}>{formatFCFA(g.salaire)}</td>
                        <td style={{ padding: '10px', fontFamily: fonts.mono, color: colors.forestLight, fontWeight: 600 }}>
                          {formatFCFA(g.retire)}
                        </td>
                        <td style={{ padding: '10px', fontFamily: fonts.mono, color: colors.muted }}>
                          {formatFCFA(g.preleve)}
                        </td>
                        <td style={{ padding: '10px', fontFamily: fonts.mono, color: g.debiteurs < 0 ? colors.danger : colors.muted }}>
                          {g.debiteurs < 0 ? formatFCFA(g.debiteurs) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: fonts.mono, fontWeight: 600,
                          color: g.reste > 0 ? colors.danger : colors.muted }}>
                          {formatFCFA(g.reste)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${colors.line}`, textAlign: 'right', background: colors.bg }}>
                      <td style={{ textAlign: 'left', padding: '11px 14px', fontWeight: 600, color: colors.forest, fontFamily: fonts.display }}>
                        Total
                      </td>
                      <td style={{ padding: '11px', fontFamily: fonts.mono, fontWeight: 600 }}>{t.agents}</td>
                      <td style={{ padding: '11px', fontFamily: fonts.mono, fontWeight: 600 }}>{formatFCFA(t.salaire)}</td>
                      <td style={{ padding: '11px', fontFamily: fonts.mono, fontWeight: 600, color: colors.forestLight }}>
                        {formatFCFA(t.retire)}
                      </td>
                      <td style={{ padding: '11px', fontFamily: fonts.mono, fontWeight: 600 }}>{formatFCFA(t.preleve)}</td>
                      <td style={{ padding: '11px', fontFamily: fonts.mono, fontWeight: 600, color: colors.danger }}>
                        {formatFCFA(groupes.reduce((x, g) => x + g.debiteurs, 0))}
                      </td>
                      <td style={{ padding: '11px 14px', fontFamily: fonts.mono, fontWeight: 600, color: colors.forestLight }}>
                        {formatFCFA(t.resteAPayer)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}

          {vue === 'agents' && groupes.map((g) => (
            <Card key={g.employeur} style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '11px 14px', background: colors.forestPale, borderBottom: `1px solid ${colors.line}`,
              }}>
                <Building2 size={15} color={colors.forestLight} style={{ flexShrink: 0 }} />
                <strong style={{ fontFamily: fonts.display, fontSize: 13, color: colors.forest }}>{g.employeur}</strong>
                <Badge tone="neutral">{g.agents.length} agent{g.agents.length > 1 ? 's' : ''}</Badge>
                {g.servis > 0 && <Badge tone="gold">{g.servis} servi{g.servis > 1 ? 's' : ''}</Badge>}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  versé {formatFCFA(g.salaire)} · retiré {formatFCFA(g.retire)} ·{' '}
                  <strong style={{ color: g.reste > 0 ? colors.danger : colors.muted }}>
                    reste {formatFCFA(g.reste)}
                  </strong>
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: fonts.body }}>
                  <thead>
                    <tr style={{ color: colors.muted, textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 500 }}>Agent</th>
                      <th style={{ padding: '8px 10px', fontWeight: 500 }}>Salaire</th>
                      <th style={{ padding: '8px 10px', fontWeight: 500 }}>Déjà retiré</th>
                      <th style={{ padding: '8px 10px', fontWeight: 500 }}>Prélevé</th>
                      <th style={{ padding: '8px 10px', fontWeight: 500 }}>Solde</th>
                      <th style={{ padding: '8px 14px', fontWeight: 500 }}>Reste à payer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.agents.map((a) => (
                      <tr
                        key={a.client_id}
                        onClick={() => setAgentOuvert(agentOuvert === a.client_id ? null : a.client_id)}
                        style={{
                          borderTop: `1px solid ${colors.line}`, textAlign: 'right', cursor: 'pointer',
                          background: agentOuvert === a.client_id ? colors.forestPale : 'transparent',
                        }}
                      >
                        <td style={{ textAlign: 'left', padding: '9px 14px' }}>
                          <div style={{ color: colors.ink }}>{a.nom}</div>
                          <div style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.mono }}>{a.client_number}</div>
                        </td>
                        <td style={{ padding: '9px 10px', fontFamily: fonts.mono }}>{formatFCFA(a.salaire)}</td>
                        <td style={{ padding: '9px 10px', fontFamily: fonts.mono, color: colors.muted }}>
                          {a.retire > 0 ? formatFCFA(a.retire) : '—'}
                        </td>
                        <td style={{ padding: '9px 10px', fontFamily: fonts.mono, color: colors.muted }}>
                          {a.preleve > 0 ? formatFCFA(a.preleve) : '—'}
                        </td>
                        <td style={{
                          padding: '9px 10px', fontFamily: fonts.mono,
                          color: a.resteAPayer < 0 ? colors.danger : colors.ink,
                        }}>
                          {formatFCFA(a.resteAPayer)}
                        </td>
                        <td style={{
                          padding: '9px 14px', fontFamily: fonts.mono, fontWeight: 600,
                          color: a.resteAPayer > 0 ? colors.forestLight : colors.muted,
                        }}>
                          {a.resteAPayer > 0 ? formatFCFA(a.resteAPayer) : a.resteAPayer < 0 ? 'à découvert' : 'servi'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
