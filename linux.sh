#!/usr/bin/env bash
# linux.sh
# Target:
#   1) Pastikan Node.js 22.20.x terpasang (jika belum → pasang 22.20.0)
#   2) Pastikan pm2 global
#   3) npm install di jkn-fp-bot-main & node-print-server
#   4) Start kedua app via pm2 + autostart (systemd)
set -euo pipefail

REQUIRED_NODE="22.20.0"

BASE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
JKN_DIR="$BASE_DIR/jkn-fp-bot-main"
PRN_DIR="$BASE_DIR/node-print-server"

echo "Base dir: $BASE_DIR"

have_cmd() { command -v "$1" >/dev/null 2>&1; }

current_node_ver=""
if have_cmd node; then
  current_node_ver="$(node -v | sed 's/^v//')"
fi

needs_node=true
if [[ -n "$current_node_ver" ]] && [[ "$current_node_ver" =~ ^22\.20\.[0-9]+$ ]]; then
  needs_node=false
fi

install_node_ubuntu_debian() {
  echo "-> Deteksi apt-get, instal Node via NodeSource 22.x..."
  sudo apt-get update -y
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

ensure_exact_22_20() {
  # Pastikan tepat di 22.20.0 (bisa beda patch di repo)
  local v
  v="$(node -v | sed 's/^v//')" || true
  if [[ ! "$v" =~ ^22\.20\.[0-9]+$ ]]; then
    echo "-> Menyetel Node ke v$REQUIRED_NODE via 'n'..."
    sudo npm -g install n
    sudo n "$REQUIRED_NODE"
    hash -r
  fi
}

if $needs_node; then
  echo "Node saat ini: ${current_node_ver:-'tidak ada / versi lain'}, butuh 22.20.x"
  if have_cmd apt-get; then
    install_node_ubuntu_debian
  elif have_cmd dnf; then
    echo "-> Deteksi dnf, instal Node 22.x..."
    sudo dnf module reset -y nodejs || true
    sudo dnf module enable -y nodejs:22 || true
    sudo dnf install -y nodejs
  elif have_cmd yum; then
    echo "-> Deteksi yum, mencoba instal Node 22.x (Enterprise/CentOS)."
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
    sudo yum install -y nodejs
  elif have_cmd pacman; then
    echo "-> Deteksi pacman, instal nodejs-lts (pastikan repo up to date)."
    sudo pacman -Sy --noconfirm nodejs npm
  else
    echo "ERROR: Paket manajer tidak dikenali. Pasang Node.js $REQUIRED_NODE secara manual lalu jalankan ulang."
    exit 1
  fi
  ensure_exact_22_20
else
  echo "Node OK: v$current_node_ver"
fi

# Pastikan npm ada (biasanya ikut node)
if ! have_cmd npm; then
  echo "ERROR: npm tidak ditemukan setelah instalasi Node."
  exit 1
fi

# pm2
if ! have_cmd pm2; then
  echo "Menginstal pm2 global..."
  sudo npm install -g pm2
fi

# Install deps (gunakan npm ci jika ada lockfile)
install_deps() {
  local dir="$1"
  [[ -d "$dir" ]] || { echo "Folder tidak ditemukan: $dir"; exit 1; }
  pushd "$dir" >/dev/null
  if [[ -f package-lock.json ]]; then
    echo "npm ci di $dir"
    npm ci
  else
    echo "npm install di $dir"
    npm install
  fi
  popd >/dev/null
}

echo "Menjalankan instalasi dependency…"
install_deps "$JKN_DIR"
install_deps "$PRN_DIR"

# Start/Restart via pm2
pm2_start_or_restart() {
  local full_script="$1"
  local name="$2"
  [[ -f "$full_script" ]] || { echo "File tidak ditemukan: $full_script"; exit 1; }
  if pm2 jlist | jq -r '.[].name' 2>/dev/null | grep -qx "$name"; then
    echo "pm2 restart $name"
    pm2 restart "$name" --update-env
  else
    echo "pm2 start $full_script --name $name"
    pm2 start "$full_script" --name "$name" --time
  fi
}

# jq opsional; jika tidak ada, fallback deteksi sederhana
if ! have_cmd jq; then
  pm2_start_or_restart() {
    local full_script="$1"
    local name="$2"
    if pm2 list | awk '{print $2}' | grep -qx "$name"; then
      echo "pm2 restart $name"
      pm2 restart "$name" --update-env
    else
      echo "pm2 start $full_script --name $name"
      pm2 start "$full_script" --name "$name" --time
    fi
  }
fi

echo "Menjalankan apps dengan pm2…"
pm2_start_or_restart "$JKN_DIR/index.js"      "jkn-fp-bot-main"
pm2_start_or_restart "$PRN_DIR/server.js"     "node-print-server"

echo "Mengaktifkan autostart pm2 (systemd)…"
# pastikan PATH berisi /usr/local/bin agar service menemukan pm2/node
sudo env "PATH=$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"
pm2 save

echo
echo "Selesai ✅"
pm2 status

