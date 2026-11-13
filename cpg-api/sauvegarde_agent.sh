#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  L'AGENT DE SAUVEGARDE, AVEC DE LA PATIENCE
# ═══════════════════════════════════════════════════════════════════
#
# L'agent launchd lancait `sauvegarder_base.mjs` directement. Les 11 et
# 12 novembre 2026, il a echoue deux soirs de suite sur :
#
#   failed to lookup address information: nodename nor servname provided
#
# — une erreur DNS. A 20h30 le Mac etait endormi ou pas encore
# reconnecte au reseau, et l'agent abandonnait au premier essai. Trois
# jours sans sauvegarde, dont celui de la paie EFF de 20 millions.
#
# Ce script reessaie. Un portable qui se reveille met quelques dizaines
# de secondes a retrouver son reseau ; attendre, c'est tout ce qu'il
# fallait. Il tente ESSAIS fois, espacees de DELAI secondes, et ne rend
# la main en echec que si toutes ont echoue — auquel cas le journal
# porte la trace des tentatives, et non plus une seule ligne d'erreur
# sans contexte.
set -uo pipefail

ESSAIS=6
DELAI=120          # deux minutes entre deux essais : douze minutes en tout
PROJET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$PROJET" || { echo "$(date '+%F %T') — dossier du projet introuvable : $PROJET"; exit 1; }

for n in $(seq 1 "$ESSAIS"); do
  echo "$(date '+%F %T') — sauvegarde, tentative $n/$ESSAIS"

  # Le reseau d'abord : inutile de reveiller Railway si le DNS ne
  # repond pas encore. Un echec ici n'est pas une erreur, juste un
  # « pas encore ».
  if ! ping -c 1 -t 5 1.1.1.1 >/dev/null 2>&1; then
    echo "$(date '+%F %T') — pas de reseau, on attend ${DELAI}s"
    [ "$n" -lt "$ESSAIS" ] && sleep "$DELAI"
    continue
  fi

  if railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs; then
    echo "$(date '+%F %T') — sauvegarde reussie a la tentative $n"
    exit 0
  fi

  echo "$(date '+%F %T') — tentative $n echouee"
  [ "$n" -lt "$ESSAIS" ] && sleep "$DELAI"
done

echo "$(date '+%F %T') — ECHEC apres $ESSAIS tentatives. Lancez a la main :"
echo "    cd $PROJET && railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs"
exit 1
