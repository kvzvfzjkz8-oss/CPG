#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  PLANIFIER LA SAUVEGARDE QUOTIDIENNE (macOS, launchd)
# ═══════════════════════════════════════════════════════════════════
#
# Une sauvegarde qu'il faut penser à lancer n'est pas lancée. Ce script
# installe un agent launchd qui prend la sauvegarde chaque soir, et la
# rattrape au prochain réveil du Mac si la machine était éteinte à
# l'heure dite (c'est le rôle de RunAtLoad combiné à StartCalendarInterval).
#
# L'URL de production ne figure dans aucun fichier : l'agent appelle
# `railway run`, qui va chercher la variable auprès de Railway.
#
#   bash cpg-api/installer_sauvegarde_quotidienne.sh            # affiche ce qui serait fait
#   bash cpg-api/installer_sauvegarde_quotidienne.sh --installer
#   bash cpg-api/installer_sauvegarde_quotidienne.sh --desinstaller
#   bash cpg-api/installer_sauvegarde_quotidienne.sh --etat
set -uo pipefail

ETIQUETTE="ga.cpg.sauvegarde"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETTE.plist"
PROJET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOURNAL="$HOME/Sauvegardes-CPG/journal.log"
HEURE=20
MINUTE=30
# Copie miroir : iCloud Drive par defaut, hors du Mac, revocable. La CLE
# n'y va jamais — elle reste dans ~/.cpg. Si les deux etaient au meme
# endroit, le chiffrement ne protegerait plus de rien.
MIROIR="${CPG_MIROIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Sauvegardes-CPG}"

usage() {
  cat <<AIDE
SAUVEGARDE QUOTIDIENNE DE LA BASE CPG

  Agent      $ETIQUETTE
  Heure      chaque jour a ${HEURE}h${MINUTE} (et au reveil si le Mac etait eteint)
  Script     $PROJET/cpg-api/sauvegarde_agent.sh (reessaie 6 fois si le reseau manque)
  Journal    $JOURNAL
  Miroir     $MIROIR
  Fichier    $PLIST

  --installer      installe et demarre l'agent
  --desinstaller   arrete et retire l'agent
  --etat           dit si l'agent est charge, et montre la fin du journal

Avant d'installer, verifiez que « railway whoami » repond : l'agent
tourne sans session interactive et utilise le jeton deja enregistre.
AIDE
}

case "${1:-}" in
  --etat)
    echo "Agent :"
    launchctl list | grep -F "$ETIQUETTE" || echo "  non charge"
    echo
    if [ -d "$HOME/Sauvegardes-CPG" ]; then
      echo "Sauvegardes locales :"
      ls -lh "$HOME/Sauvegardes-CPG"/*.dump.enc 2>/dev/null | awk '{print "  "$9"  "$5}' || echo "  aucune"
    fi
    echo
    if [ -d "$MIROIR" ]; then
      echo "Copies miroir :"
      ls -lh "$MIROIR"/*.dump.enc 2>/dev/null | awk '{print "  "$9"  "$5}' || echo "  aucune"
    fi
    echo
    if [ -f "$JOURNAL" ]; then
      echo "Fin du journal :"
      tail -15 "$JOURNAL" | sed 's/^/  /'
    else
      echo "Pas encore de journal."
    fi
    exit 0
    ;;
  --desinstaller)
    launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo "Agent $ETIQUETTE retire. Les sauvegardes deja prises ne sont pas touchees."
    exit 0
    ;;
  --installer) ;;
  *) usage; exit 0 ;;
esac

command -v railway >/dev/null || { echo "La commande railway est introuvable."; exit 1; }
RAILWAY="$(command -v railway)"
NODE="$(command -v node)" || { echo "node introuvable."; exit 1; }
PGBIN="/Applications/Postgres.app/Contents/Versions/latest/bin"
[ -x "$PGBIN/pg_dump" ] || { echo "pg_dump introuvable dans $PGBIN."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Sauvegardes-CPG" "$MIROIR"

# Garde-fou : la cle ne doit jamais se trouver sous le miroir. Les deux
# au meme endroit, et un acces au nuage donnerait les donnees en clair.
case "$HOME/.cpg" in
  "$MIROIR"*) echo "REFUS : la cle (~/.cpg) est sous le miroir $MIROIR."; exit 1;;
esac

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETTE</string>
  <key>WorkingDirectory</key><string>$PROJET</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PROJET/cpg-api/sauvegarde_agent.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PGBIN:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CPG_MIROIR</key><string>$MIROIR</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HEURE</integer><key>Minute</key><integer>$MINUTE</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$JOURNAL</string>
  <key>StandardErrorPath</key><string>$JOURNAL</string>
</dict>
</plist>
PL

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" || { echo "launchctl load a echoue."; exit 1; }

echo "Agent $ETIQUETTE installe."
echo "  sauvegarde chaque jour a ${HEURE}h${MINUTE}, et au demarrage du Mac"
echo "  copie miroir : $MIROIR"
echo "  journal : $JOURNAL"
echo
echo "Il vient de se lancer une premiere fois ; j'attends le resultat…"
sleep 25

# macOS protege ~/Documents : un agent launchd n'y a pas acces tant que
# le binaire qu'il lance n'a pas l'« Acces complet au disque ». Et
# `railway run` DOIT tourner dans le dossier du projet, puisque c'est
# la qu'est enregistre le lien vers le projet Railway — on ne peut donc
# pas deplacer le script hors de Documents pour contourner.
if grep -qi "failed to lookup address information\|dns error" "$JOURNAL" 2>/dev/null \
   && ! ls "$HOME/Sauvegardes-CPG"/*.dump.enc >/dev/null 2>&1; then
  echo
  echo "  Le journal montre une erreur DNS : le Mac n'avait pas de reseau."
  echo "  Le script de l'agent reessaie maintenant 6 fois sur 12 minutes,"
  echo "  ce qui suffit a couvrir un reveil de veille."
fi

if grep -qi "operation not permitted" "$JOURNAL" 2>/dev/null; then
  cat <<REMEDE

  ────────────────────────────────────────────────────────────────────
  L'AGENT EST INSTALLE MAIS IL NE PEUT PAS ENCORE TRAVAILLER
  ────────────────────────────────────────────────────────────────────

  Le journal dit « Operation not permitted ». La cause est macOS : le
  projet est dans ~/Documents, un dossier protege, et un agent lance
  par launchd n'y a pas acces.

  Un geste a faire une seule fois, sans rien stocker nulle part :

    Reglages Systeme > Confidentialite et securite > Acces complet au disque
    Bouton +, puis Cmd+Maj+G et coller :  $RAILWAY
    Activer l'interrupteur en face de « railway »

  Puis relancer :
    bash cpg-api/installer_sauvegarde_quotidienne.sh --installer

  Autre solution, si vous preferez ne rien autoriser : deplacer le
  projet hors de ~/Documents, par exemple dans ~/Projets, puis
  « railway link » une fois dans le nouveau dossier.

  En attendant, la sauvegarde manuelle fonctionne parfaitement :
    railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs
  ────────────────────────────────────────────────────────────────────
REMEDE
  exit 1
fi

if ls "$HOME/Sauvegardes-CPG"/*.dump.enc >/dev/null 2>&1; then
  echo
  echo "Premiere sauvegarde automatique prise :"
  ls -t "$HOME/Sauvegardes-CPG"/*.dump.enc | head -1 | sed 's/^/  /'
  echo
  echo "Etat complet :  bash cpg-api/installer_sauvegarde_quotidienne.sh --etat"
else
  echo
  echo "Rien n'est encore apparu. Regardez le journal :"
  echo "  tail -20 $JOURNAL"
fi
