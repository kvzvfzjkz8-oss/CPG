import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from './UI';
import { fetchCreditRequests, fetchClientDetail, supprimerCreditActif, suspendreCreditActif, reactiverCreditSuspendu, fetchHistoriqueClient, imprimerHistoriqueClient } from '../api/adminApi';

const STATUT_LABEL = {
  en_verification: 'En attente de validation niveau 1',
  valide_niveau1: 'Validé niveau 1 — en attente de commission',
  en_attente_commission: 'Déposé en commission',
  valide_commission: 'Validé en commission — en attente de double validation',
  valide_double: "Double validation faite — en attente d'approbation finale",
  approuve: 'Approuvé — crédit actif',
  suspendu: 'Suspendu',
  annule: 'Annulé',
  rejete: 'Rejeté',
};
const STATUT_TONE = {
  approuve: 'neutral', rejete: 'danger', en_verification: 'neutral', suspendu: 'gold', annule: 'danger',
};

/**
 * Liste des clients ayant un crédit actif (approuvé) — accessible à
 * tout le personnel (opérateur, gestionnaire, caissier, directeur) :
 * utile pour situer rapidement un client qui se présente, sans avoir
 * à ouvrir chaque dossier séparément. Lecture uniquement.
 */
export function CreditsEnCoursPanel({ role }) {
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientOuvert, setClientOuvert] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [deleteMotif, setDeleteMotif] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [confirmingSuspendId, setConfirmingSuspendId] = useState(null);
  const [suspendMotif, setSuspendMotif] = useState('');
  const [suspendBusy, setSuspendBusy] = useState(null);
  const [suspendError, setSuspendError] = useState('');
  const [recherche, setRecherche] = useState('');

  const peutGerer = role === 'directeur' || role === 'superviseur';

  const load = () => {
    Promise.all([
      fetchCreditRequests('approuve'),
      fetchCreditRequests('suspendu'),
    ])
      .then(([actifs, suspendus]) => {
        const fusion = [...actifs, ...suspendus];
        fusion.sort((a, b) => a.client.localeCompare(b.client));
        setCredits(fusion);
      })
      .catch(() => setCredits([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const doDelete = async (c) => {
    if (deleteMotif.trim().length < 5) {
      setDeleteError('Précisez le motif (5 caractères minimum).');
      return;
    }
    setDeleteBusy(c.id);
    setDeleteError('');
    try {
      await supprimerCreditActif(c.id, deleteMotif.trim());
      setConfirmingDeleteId(null);
      setDeleteMotif('');
      load();
    } catch (err) {
      setDeleteError(err.message ?? 'Suppression impossible.');
    } finally {
      setDeleteBusy(null);
    }
  };

  const doSuspend = async (c) => {
    if (suspendMotif.trim().length < 5) {
      setSuspendError('Précisez le motif (5 caractères minimum).');
      return;
    }
    setSuspendBusy(c.id);
    setSuspendError('');
    try {
      await suspendreCreditActif(c.id, suspendMotif.trim());
      setConfirmingSuspendId(null);
      setSuspendMotif('');
      load();
    } catch (err) {
      setSuspendError(err.message ?? 'Suspension impossible.');
    } finally {
      setSuspendBusy(null);
    }
  };

  const doReactiver = async (c) => {
    setSuspendBusy(c.id);
    try {
      await reactiverCreditSuspendu(c.id);
      load();
    } catch (err) {
      setSuspendError(err.message ?? 'Réactivation impossible.');
    } finally {
      setSuspendBusy(null);
    }
  };

  const credistFiltres = recherche.trim()
    ? credits.filter((c) => c.client.toLowerCase().includes(recherche.trim().toLowerCase()))
    : credits;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <SectionTitle
        right={
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un nom…"
            style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${colors.line}`, fontSize: 11, fontFamily: fonts.body }}
          />
        }
      >
        {loading ? 'Chargement…' : `${credistFiltres.length} client${credistFiltres.length > 1 ? 's' : ''} avec un crédit en cours`}
      </SectionTitle>

      {!loading && credistFiltres.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          {recherche.trim() ? 'Aucun client correspondant.' : 'Aucun crédit en cours pour le moment.'}
        </p>
      )}

      {credistFiltres.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            padding: '14px 20px', borderBottom: `1px solid ${colors.line}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setClientOuvert({ id: c.client_id, nom: c.client })}
                style={{ margin: 0, padding: 0, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 500, color: colors.forestLight, fontFamily: fonts.body, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {c.client}
              </button>
              <span style={{ fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>· {c.reference}</span>
              {c.status === 'suspendu' && <Badge tone="gold">Suspendu</Badge>}
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {c.job_title ?? ''}{c.job_title && c.employer ? ' · ' : ''}{c.employer ?? ''}
              {c.client_number ? ` · ${c.client_number}` : ''}
              {c.approved_at ? ` · Débloqué le ${new Date(c.approved_at).toLocaleDateString('fr-FR')}` : ''}
            </p>
            {role === 'directeur' && confirmingDeleteId === c.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <input
                  value={deleteMotif}
                  onChange={(e) => setDeleteMotif(e.target.value)}
                  placeholder="Motif de la suppression"
                  style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${colors.line}`, fontSize: 11, fontFamily: fonts.body, width: 180 }}
                />
                <button
                  onClick={() => doDelete(c)}
                  disabled={deleteBusy === c.id}
                  style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: colors.danger, color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer' }}
                >
                  Confirmer
                </button>
                <button
                  onClick={() => { setConfirmingDeleteId(null); setDeleteMotif(''); setDeleteError(''); }}
                  style={{ border: 'none', background: 'transparent', color: colors.muted, fontSize: 11, cursor: 'pointer', fontFamily: fonts.body }}
                >
                  Annuler
                </button>
                {deleteError && <span style={{ fontSize: 10, color: colors.danger, fontFamily: fonts.body }}>{deleteError}</span>}
              </div>
            )}
            {peutGerer && confirmingSuspendId === c.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <input
                  value={suspendMotif}
                  onChange={(e) => setSuspendMotif(e.target.value)}
                  placeholder="Motif de la suspension"
                  style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${colors.line}`, fontSize: 11, fontFamily: fonts.body, width: 180 }}
                />
                <button
                  onClick={() => doSuspend(c)}
                  disabled={suspendBusy === c.id}
                  style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: colors.goldDark, color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer' }}
                >
                  Confirmer
                </button>
                <button
                  onClick={() => { setConfirmingSuspendId(null); setSuspendMotif(''); setSuspendError(''); }}
                  style={{ border: 'none', background: 'transparent', color: colors.muted, fontSize: 11, cursor: 'pointer', fontFamily: fonts.body }}
                >
                  Annuler
                </button>
                {suspendError && <span style={{ fontSize: 10, color: colors.danger, fontFamily: fonts.body }}>{suspendError}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
              {formatFCFA(c.amount)} F
            </p>
            {peutGerer && c.status === 'approuve' && confirmingSuspendId !== c.id && (
              <button
                onClick={() => setConfirmingSuspendId(c.id)}
                title="Suspendre temporairement ce crédit (réversible)"
                style={{ border: 'none', background: 'transparent', color: colors.goldDark, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}
              >
                Suspendre
              </button>
            )}
            {peutGerer && c.status === 'suspendu' && (
              <button
                onClick={() => doReactiver(c)}
                disabled={suspendBusy === c.id}
                title="Lever la suspension"
                style={{ border: 'none', background: 'transparent', color: colors.forestLight, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}
              >
                {suspendBusy === c.id ? '…' : 'Réactiver'}
              </button>
            )}
            {role === 'directeur' && confirmingDeleteId !== c.id && (
              <button
                onClick={() => setConfirmingDeleteId(c.id)}
                title="Supprimer ce crédit (créé en excès)"
                style={{ border: 'none', background: 'transparent', color: colors.danger, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}
              >
                Supprimer
              </button>
            )}
          </div>
        </div>
      ))}

      {clientOuvert && <ClientDetailModal clientId={clientOuvert.id} nom={clientOuvert.nom} onClose={() => setClientOuvert(null)} />}
    </Card>
  );
}

/**
 * Fiche client — informations et historique complet des crédits,
 * ouverte en cliquant sur un nom n'importe où dans le back-office.
 * Consultation uniquement : aucune action possible depuis ici.
 */
export function ClientDetailModal({ clientId, nom, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historique, setHistorique] = useState(null);
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const [imprBusy, setImprBusy] = useState(false);

  useEffect(() => {
    if (!clientId) { setLoading(false); setError('Identifiant client indisponible pour ce dossier.'); return; }
    fetchClientDetail(clientId)
      .then(setDetail)
      .catch((e) => setError(e.message ?? 'Impossible de charger la fiche client.'))
      .finally(() => setLoading(false));
  }, [clientId]);

  const voirHistorique = () => {
    if (historiqueOuvert) { setHistoriqueOuvert(false); return; }
    setHistoriqueOuvert(true);
    if (!historique) {
      fetchHistoriqueClient(clientId).then((d) => setHistorique(d.transactions));
    }
  };

  const imprimer = async () => {
    setImprBusy(true);
    try {
      await imprimerHistoriqueClient(clientId, detail?.client.client_number);
    } finally {
      setImprBusy(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,61,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, width: 520, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.ink, fontFamily: fonts.display }}>
            {detail?.client.full_name ?? nom ?? 'Fiche client'}
          </p>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={18} color={colors.muted} />
          </button>
        </div>

        {loading && <p style={{ fontSize: 13, color: colors.muted, fontFamily: fonts.body }}>Chargement…</p>}
        {error && <p style={{ fontSize: 13, color: colors.danger, fontFamily: fonts.body }}>{error}</p>}

        {detail && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <InfoLigne label="Numéro client" valeur={detail.client.client_number ?? '—'} />
              <InfoLigne label="Téléphone" valeur={detail.client.phone ?? '—'} />
              <InfoLigne label="Poste" valeur={detail.client.job_title ?? '—'} />
              <InfoLigne label="Employeur" valeur={detail.client.employer ?? '—'} />
              <InfoLigne label="Solde du compte" valeur={`${formatFCFA(detail.client.balance ?? 0)} F`} />
              <InfoLigne label="Statut" valeur={detail.client.status === 'actif' ? 'Actif' : detail.client.status === 'suspendu' ? 'Suspendu' : 'Fermé'} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button
                onClick={voirHistorique}
                style={{ padding: '7px 14px', borderRadius: 9, border: `1px solid ${colors.line}`, background: '#fff', color: colors.forestLight, fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer' }}
              >
                {historiqueOuvert ? 'Masquer l\'historique' : 'Voir l\'historique des transactions'}
              </button>
              <button
                onClick={imprimer}
                disabled={imprBusy}
                style={{ padding: '7px 14px', borderRadius: 9, border: 'none', background: colors.forest, color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: 'pointer' }}
              >
                {imprBusy ? 'Génération…' : 'Imprimer'}
              </button>
            </div>

            {historiqueOuvert && (
              <div style={{ marginBottom: 20 }}>
                {!historique ? (
                  <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>Chargement…</p>
                ) : historique.length === 0 ? (
                  <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, fontStyle: 'italic' }}>Aucune transaction.</p>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${colors.line}`, borderRadius: 10 }}>
                    {historique.map((t) => {
                      const entree = ['depot', 'deblocage_credit', 'ajustement', 'salaire'].includes(t.type);
                      return (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${colors.line}` }}>
                          <div>
                            <p style={{ margin: 0, fontSize: 11, color: colors.ink, fontFamily: fonts.body }}>{t.label ?? t.type}</p>
                            <p style={{ margin: '1px 0 0', fontSize: 10, color: colors.muted, fontFamily: fonts.body }}>{new Date(t.created_at).toLocaleDateString('fr-FR')}</p>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: fonts.mono, color: entree ? colors.forest : colors.danger }}>
                            {entree ? '+' : '-'}{formatFCFA(Math.abs(t.amount))} F
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
              Crédits ({detail.credits.length})
            </p>
            {detail.credits.length === 0 ? (
              <p style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.body, fontStyle: 'italic' }}>
                Aucun crédit pour ce client.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.credits.map((c) => (
                  <div key={c.id} style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${colors.line}`, background: colors.bg }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>{c.reference}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono }}>{formatFCFA(c.amount)} F</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <Badge tone={STATUT_TONE[c.status] ?? 'gold'}>{STATUT_LABEL[c.status] ?? c.status}</Badge>
                      <span style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>{c.duration_months} mois</span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 10, color: colors.muted, fontFamily: fonts.body }}>
                      Demandé le {new Date(c.created_at).toLocaleDateString('fr-FR')}
                      {c.approved_at ? ` · Débloqué le ${new Date(c.approved_at).toLocaleDateString('fr-FR')}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InfoLigne({ label, valeur }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, color: colors.muted, fontFamily: fonts.body, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 13, color: colors.ink, fontFamily: fonts.body }}>{valeur}</p>
    </div>
  );
}
