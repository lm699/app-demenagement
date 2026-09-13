#!/usr/bin/env bash
#
# Installation de l'app Déménagement sur Raspberry Pi (Raspberry Pi OS / Debian).
#
#   ./install-raspberrypi.sh <url-du-depot-git> [options]
#
# Options :
#   --dir <dossier>     où cloner le projet            (défaut : ~/demenagement)
#   --branch <branche>  branche à récupérer            (défaut : celle du dépôt)
#   --service           installe aussi un service systemd lancé au démarrage
#
# Relancer le script sur un dossier déjà cloné fait un `git pull` puis réinstalle
# les dépendances : il sert aussi de script de mise à jour.
#
set -euo pipefail

NODE_MAJOR=22
NODE_MIN_MINOR=13          # node:sqlite n'est utilisable sans option qu'à partir de 22.13
APP_NAME=demenagement

REPO_URL="${REPO_URL:-}"
APP_DIR="$HOME/$APP_NAME"
BRANCH=""
WITH_SERVICE=0

info() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m/!\\\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

usage() { sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)     APP_DIR="${2:?--dir attend un dossier}"; shift 2 ;;
    --branch)  BRANCH="${2:?--branch attend un nom de branche}"; shift 2 ;;
    --service) WITH_SERVICE=1; shift ;;
    -h|--help) usage 0 ;;
    -*)        die "option inconnue : $1" ;;
    *)         REPO_URL="$1"; shift ;;
  esac
done

[ -n "$REPO_URL" ] || { warn "URL du dépôt git manquante."; usage 1; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
  warn "Lancé en root : l'app appartiendra à root. Préfère un utilisateur normal (sudo sera demandé)."
else
  command -v sudo >/dev/null || die "sudo est introuvable."
  SUDO="sudo"
fi

# ---------------------------------------------------------------------------
# 1. Architecture
# ---------------------------------------------------------------------------
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ;;
  armv7l)
    warn "OS 32 bits détecté (armv7l). Ça peut marcher, mais Raspberry Pi OS 64 bits est"
    warn "fortement conseillé : Node $NODE_MAJOR et @napi-rs/canvas y sont bien mieux supportés." ;;
  armv6l)
    die "Pi Zero / Pi 1 (armv6) : Node $NODE_MAJOR n'existe pas pour cette architecture." ;;
  x86_64) ;;
  *) warn "Architecture non testée : $ARCH" ;;
esac

# ---------------------------------------------------------------------------
# 2. Paquets système
# ---------------------------------------------------------------------------
info "Paquets système (git, curl, polices)"
$SUDO apt-get update
# Les étiquettes sont dessinées en « Arial, sans-serif » : sans police installée,
# le texte des étiquettes sortirait vide ou en carrés. Liberation Sans a les mêmes
# métriques qu'Arial, DejaVu couvre les flèches et symboles.
$SUDO apt-get install -y --no-install-recommends \
  git ca-certificates curl gnupg \
  fontconfig fonts-liberation2 fonts-dejavu-core

# ---------------------------------------------------------------------------
# 3. Node.js >= 22.13
# ---------------------------------------------------------------------------
node_ok() {
  command -v node >/dev/null || return 1
  local v major minor
  v="$(node -p 'process.versions.node')"
  major="${v%%.*}"; minor="$(echo "$v" | cut -d. -f2)"
  [ "$major" -gt "$NODE_MAJOR" ] || { [ "$major" -eq "$NODE_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; }
}

if node_ok; then
  info "Node.js $(node -v) déjà présent"
else
  info "Installation de Node.js $NODE_MAJOR (dépôt NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
  node_ok || die "Node $(node -v 2>/dev/null || echo absent) installé, il faut >= $NODE_MAJOR.$NODE_MIN_MINOR."
fi
echo "node $(node -v) / npm $(npm -v)"

# ---------------------------------------------------------------------------
# 4. Récupération du projet
# ---------------------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  info "Mise à jour du projet dans $APP_DIR"
  git -C "$APP_DIR" fetch --prune
  [ -z "$BRANCH" ] || git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only
elif [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  die "$APP_DIR existe déjà et n'est pas un dépôt git. Choisis un autre dossier avec --dir."
else
  info "Clonage de $REPO_URL dans $APP_DIR"
  if [ -n "$BRANCH" ]; then
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  else
    git clone "$REPO_URL" "$APP_DIR"
  fi
fi

cd "$APP_DIR"

# ---------------------------------------------------------------------------
# 5. Dépendances npm
# ---------------------------------------------------------------------------
info "Dépendances npm"
# node_modules copié depuis Windows = binaires natifs Windows : on repart de zéro.
rm -rf node_modules
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

info "Vérification des modules natifs"
node -e "
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  require('node:sqlite');
  const ctx = createCanvas(200, 50).getContext('2d');
  ctx.font = 'bold 30px Arial, sans-serif';
  if (!(ctx.measureText('L-042').width > 0)) throw new Error('aucune police utilisable par le canvas');
  const fams = GlobalFonts.families.map(f => f.family);
  console.log('canvas OK, sqlite OK, ' + fams.length + ' familles de polices');
" || die "Les modules natifs ne se chargent pas (voir l'erreur ci-dessus)."

mkdir -p data/photos data/labels

# ---------------------------------------------------------------------------
# 6. Service systemd (optionnel)
# ---------------------------------------------------------------------------
if [ "$WITH_SERVICE" -eq 1 ]; then
  info "Service systemd $APP_NAME"
  RUN_USER="$(id -un)"
  NODE_BIN="$(command -v node)"
  $SUDO tee "/etc/systemd/system/$APP_NAME.service" >/dev/null <<EOF
[Unit]
Description=Déménagement - inventaire des cartons
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HTTPS_PORT=3443
ExecStart=$NODE_BIN server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "$APP_NAME"
  sleep 2
  $SUDO systemctl --no-pager --lines=15 status "$APP_NAME" || true
fi

# ---------------------------------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
info "Installation terminée"
cat <<EOF
  Dossier  : $APP_DIR
  Web      : http://${IP:-<ip-du-pi>}:3000
  Scan live: https://${IP:-<ip-du-pi>}:3443

EOF
if [ "$WITH_SERVICE" -eq 1 ]; then
  echo "  Logs     : journalctl -u $APP_NAME -f"
  echo "  Relancer : sudo systemctl restart $APP_NAME"
else
  echo "  Démarrer : cd $APP_DIR && npm start"
  echo "  (relancer avec --service pour un démarrage automatique au boot)"
fi
cat <<EOF

  Pour reprendre les cartons existants, copier le dossier data/ du PC
  (serveur arrêté des deux côtés) :
    scp -r data/ $(id -un)@${IP:-<ip-du-pi>}:$APP_DIR/
EOF
