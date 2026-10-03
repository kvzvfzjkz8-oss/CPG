/**
 * ─────────────────────────────────────────────────────────────────────
 *  HISTORIQUE DES SÉANCES DE COMMISSION
 * ─────────────────────────────────────────────────────────────────────
 *
 * L'onglet Commission ne montre que la séance programmée : une fois
 * tenue, elle et ses décisions n'étaient plus consultables nulle part.
 * Cette vue donne accès à toutes les séances et, pour chacune, aux
 * dossiers et aux points qui y ont été tranchés.
 *
 * Lecture seule — rien ne s'y modifie.
 */
import React, { useState, useEffect } from 'react';
import { History, Gavel, Check, X, Clock, ChevronLeft, AlertTriangle, Sparkles, Trash2 } from 'lucide-react';
import { colors, fonts, formatFCFA } from '../theme';
import { Card, Badge, SectionTitle } from '../components/UI';
import { fetchCommissionSessions, fetchCommissionSessionDetail } from '../api/adminApi';

const STATUT_SEANCE = {
  planifiee: { libelle: 'Programmée', tone: 'gold' },
  tenue: { libelle: 'Tenue', tone: 'neutral' },
  annulee: { libelle: 'Annulée', tone: 'danger' },
};

/** Les quatre sorties possibles d'un point à l'ordre du jour. */
const DECISION = {
  valide: { libelle: 'Validé', tone: 'neutral', Icone: Check, couleur: colors.forestLight },
  refuse: { libelle: 'Refusé', tone: 'danger', Icone: X, couleur: colors.danger },
  non_tranche: { libelle: 'Non tranché', tone: 'gold', Icone: Clock, couleur: colors.goldDark },
  supprime: { libelle: 'Supprimé', tone: 'danger', Icone: Trash2, couleur: colors.danger },
};

/** Statuts de crédit tels qu'affichés — le dossier a pu évoluer après la séance. */
const STATUT_CREDIT = {
  en_verification: 'En vérification',
  valide_niveau1: 'Validé niveau 1',
  en_attente_commission: 'En attente de commission',
  valide_commission: 'Validé en commission',
  valide_double: 'Double validation faite',
  approuve: 'Approuvé — fonds débloqués',
  rejete: 'Rejeté',
  solde: 'Soldé',
  annule: 'Annulé',
  suspendu: 'Suspendu',
};

function formatDateHeure(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Petit compteur coloré, masqué quand il vaut zéro pour ne pas encombrer. */
function Compteur({ nombre, libelle, couleur }) {
  if (!nombre) return null;
  return (
    <span style={{ fontSize: 11, color: couleur, fontFamily: fonts.body, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {nombre} {libelle}{nombre > 1 ? 's' : ''}
    </span>
  );
}

function ListeSeances({ seances, onOuvrir }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <SectionTitle>
        {seances.length} séance{seances.length > 1 ? 's' : ''}
      </SectionTitle>
      {seances.length === 0 && (
        <p style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13, fontFamily: fonts.body }}>
          Aucune séance enregistrée.
        </p>
      )}
      {seances.map((s) => {
        const statut = STATUT_SEANCE[s.status] ?? { libelle: s.status, tone: 'neutral' };
        const total = s.credits_valides + s.credits_refuses + s.credits_non_tranches
          + s.points_valides + s.points_refuses + s.points_non_tranches + s.points_supprimes;
        return (
          <div
            key={s.id}
            onClick={() => onOuvrir(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOuvrir(s.id); }}
            style={{
              padding: '14px 20px', borderBottom: `1px solid ${colors.line}`,
              cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, fontFamily: fonts.body }}>
                  {formatDateHeure(s.scheduled_for)}
                </p>
                <Badge tone={statut.tone}>{statut.libelle}</Badge>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                Programmée par {s.programmee_par}
                {s.tenue_par ? ` · tenue par ${s.tenue_par} le ${formatDateHeure(s.held_at)}` : ''}
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 5, flexWrap: 'wrap' }}>
                <Compteur nombre={s.credits_valides} libelle="dossier validé" couleur={colors.forestLight} />
                <Compteur nombre={s.credits_refuses} libelle="dossier refusé" couleur={colors.danger} />
                <Compteur nombre={s.credits_non_tranches} libelle="dossier non tranché" couleur={colors.goldDark} />
                <Compteur nombre={s.points_valides} libelle="point validé" couleur={colors.forestLight} />
                <Compteur nombre={s.points_refuses} libelle="point refusé" couleur={colors.danger} />
                <Compteur nombre={s.points_non_tranches} libelle="point non tranché" couleur={colors.goldDark} />
                <Compteur nombre={s.points_supprimes} libelle="point supprimé" couleur={colors.danger} />
                {total === 0 && (
                  <span style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                    Ordre du jour vide
                  </span>
                )}
              </div>
            </div>
            <span style={{ fontSize: 11, color: colors.forestLight, fontWeight: 600, fontFamily: fonts.body }}>
              Voir le détail
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function LigneDecision({ decision, children, note }) {
  const d = DECISION[decision] ?? DECISION.non_tranche;
  const { Icone } = d;
  return (
    <div style={{
      padding: '14px 20px', borderBottom: `1px solid ${colors.line}`,
      display: 'flex', gap: 14, alignItems: 'flex-start',
    }}>
      <div
        style={{
          width: 26, height: 26, borderRadius: 8, flexShrink: 0,
          background: decision === 'valide' ? colors.forestPale
            : decision === 'non_tranche' ? colors.goldPale : colors.dangerPale,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icone size={14} color={d.couleur} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
        {note && (
          <p style={{ margin: '5px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body, fontStyle: 'italic' }}>
            « {note} »
          </p>
        )}
      </div>
      <span style={{ flexShrink: 0 }}>
        <Badge tone={d.tone}>{d.libelle}</Badge>
      </span>
    </div>
  );
}

function DetailSeance({ detail, onRetour }) {
  const { seance, credits, points } = detail;
  const statut = STATUT_SEANCE[seance.status] ?? { libelle: seance.status, tone: 'neutral' };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card style={{ padding: 20 }}>
        <button
          onClick={onRetour}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent',
            color: colors.forestLight, fontSize: 12, fontWeight: 600, fontFamily: fonts.body,
            cursor: 'pointer', padding: 0, marginBottom: 14,
          }}
        >
          <ChevronLeft size={14} /> Toutes les séances
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Gavel size={18} color={colors.forest} />
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: colors.ink, fontFamily: fonts.display }}>
            Séance du {formatDateHeure(seance.scheduled_for)}
          </p>
          <Badge tone={statut.tone}>{statut.libelle}</Badge>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
          Programmée par {seance.programmee_par}
          {seance.tenue_par
            ? ` · tenue par ${seance.tenue_par} le ${formatDateHeure(seance.held_at)}`
            : seance.status === 'annulee' ? ' · annulée avant d’être tenue' : ' · pas encore tenue'}
        </p>
        {seance.note && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: colors.ink, fontFamily: fonts.body }}>
            {seance.note}
          </p>
        )}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>
          {credits.length} demande{credits.length > 1 ? 's' : ''} de crédit
        </SectionTitle>
        {credits.length === 0 && (
          <p style={{ padding: 24, textAlign: 'center', color: colors.muted, fontSize: 12, fontFamily: fonts.body }}>
            Aucune demande de crédit à l’ordre du jour de cette séance.
          </p>
        )}
        {credits.map((c) => (
          <LigneDecision key={c.id} decision={c.decision} note={c.commission_decision_note}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
              {c.client} · {c.reference}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {c.job_title ?? c.employer ?? '—'} · {formatFCFA(c.amount)} F sur {c.duration_months} mois
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {c.decide_par ? `Tranché par ${c.decide_par} le ${formatDate(c.commission_decided_at)} · ` : ''}
              aujourd’hui : {STATUT_CREDIT[c.statut_actuel] ?? c.statut_actuel}
            </p>
            {c.commission_note && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                Note d’analyse : {c.commission_note}
              </p>
            )}
          </LigneDecision>
        ))}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionTitle>
          {points.length} point{points.length > 1 ? 's' : ''} à l’ordre du jour
        </SectionTitle>
        {points.length === 0 && (
          <p style={{ padding: 24, textAlign: 'center', color: colors.muted, fontSize: 12, fontFamily: fonts.body }}>
            Aucun dossier en difficulté ni demande exceptionnelle pour cette séance.
          </p>
        )}
        {points.map((p) => (
          <LigneDecision key={p.id} decision={p.decision} note={p.decision_note}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink, fontFamily: fonts.body }}>
                {p.client ?? '—'}
              </p>
              <Badge tone={p.type === 'dossier_difficulte' ? 'danger' : 'gold'}>
                {p.type === 'dossier_difficulte' ? 'Dossier en difficulté' : 'Demande exceptionnelle'}
              </Badge>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.ink, fontFamily: fonts.body }}>
              {p.titre}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
              {p.credit_reference ? `Réf. ${p.credit_reference} · ` : ''}
              {p.decide_par ? `tranché par ${p.decide_par} le ${formatDate(p.decided_at)}` : 'non tranché'}
            </p>
            {p.note && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                Note de dépôt : {p.note}
              </p>
            )}
          </LigneDecision>
        ))}
      </Card>
    </div>
  );
}

export default function CommissionHistoryView() {
  const [seances, setSeances] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    fetchCommissionSessions()
      .then(setSeances)
      .catch((e) => setErreur(e.message ?? 'Chargement impossible.'))
      .finally(() => setLoading(false));
  }, []);

  const ouvrir = async (sessionId) => {
    setLoadingDetail(true);
    setErreur('');
    try {
      setDetail(await fetchCommissionSessionDetail(sessionId));
    } catch (e) {
      setErreur(e.message ?? 'Détail indisponible.');
    } finally {
      setLoadingDetail(false);
    }
  };

  if (loading) {
    return (
      <Card style={{ padding: 28, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 13, color: colors.muted, fontFamily: fonts.body }}>Chargement…</p>
      </Card>
    );
  }

  return (
    <div>
      {erreur && (
        <div style={{
          background: colors.dangerPale, border: `1px solid ${colors.danger}`, borderRadius: 12,
          padding: '11px 16px', marginBottom: 16, fontSize: 12, color: colors.danger,
          fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={14} /> {erreur}
        </div>
      )}
      {detail
        ? <DetailSeance detail={detail} onRetour={() => setDetail(null)} />
        : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <History size={16} color={colors.forest} />
              <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontFamily: fonts.body }}>
                Cliquez sur une séance pour voir les dossiers validés et refusés qui y ont été tranchés.
              </p>
              {loadingDetail && (
                <span style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.body }}>
                  <Sparkles size={11} /> ouverture…
                </span>
              )}
            </div>
            <ListeSeances seances={seances} onOuvrir={ouvrir} />
          </>
        )}
    </div>
  );
}
