import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from './UI';
import { fetchCreditRequests, fetchClientDetail } from '../api/adminApi';

const STATUT_LABEL = {
  en_verification: 'En attente de validation niveau 1',
  valide_niveau1: 'Validé niveau 1 — en attente de commission',
  en_attente_commission: 'Déposé en commission',
  valide_commission: 'Validé en commission — en attente de double validation',
  valide_double: "Double validation faite — en attente d'approbation finale",
  approuve: 'Approuvé — crédit actif',
  rejete: 'Rejeté',
};
const STATUT_TONE = {
  approuve: 'neutral', rejete: 'danger', en_verification: 'neutral',
};

/**
 * Liste des clients ayant un crédit actif (approuvé) — accessible à
 * tout le personnel (opérateur, gestionnaire, caissier, directeur) :
 * utile pour situer rapidement un client qui se présente, sans avoir
 * à ouvrir chaque dossier séparément. Lecture uniquement.
 */
export function CreditsEnCoursPanel() {
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientOuvert, setClientOuvert] = useState(null);

  useEffect(() => {
    fetchCreditRequests('approuve').then(setCredits).finally(() => setLoading(false));
  }, []);

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <SectionTitle>
        {loading ? 'Chargement…' : `${credits.length} client${credits.length > 1 ? 's' : ''} avec un crédit en cours`}
      </SectionTitle>

      {!loading && credits.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucun crédit en cours pour le moment.
        </p>
      )}

      {credits.map((c) => (
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
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {c.job_title ?? ''}{c.job_title && c.employer ? ' · ' : ''}{c.employer ?? ''}
              {c.client_number ? ` · ${c.client_number}` : ''}
            </p>
          </div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.ink, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
            {formatFCFA(c.amount)} F
          </p>
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

  useEffect(() => {
    if (!clientId) { setLoading(false); setError('Identifiant client indisponible pour ce dossier.'); return; }
    fetchClientDetail(clientId)
      .then(setDetail)
      .catch((e) => setError(e.message ?? 'Impossible de charger la fiche client.'))
      .finally(() => setLoading(false));
  }, [clientId]);

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
