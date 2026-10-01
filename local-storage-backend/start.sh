#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "========================================================"
echo "   Starting MinIO S3 Secure Storage Stack (Ngrok)..."
echo "========================================================"

# 1. Initialize .env if missing
if [ ! -f .env ]; then
    echo "[*] .env file not found. Generating default configuration..."
    RAND_PASS=$(openssl rand -hex 16 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 24 | head -n 1)
    cat <<EOF > .env
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=${RAND_PASS}
MINIO_DEFAULT_BUCKET=app-images

# Ngrok Static Domain Config
NGROK_AUTHTOKEN=
NGROK_DOMAIN=
MINIO_SERVER_URL=https://api.your-tunnel.com
EOF
    echo "[+] Created .env file."
fi

# 2. Launch Docker Compose Stack
echo "[*] Launching Docker Compose stack (minio, minio-init, ngrok-tunnel)..."
docker compose up -d --build

# 3. Determine URL
NGROK_DOMAIN=$(grep '^NGROK_DOMAIN=' .env | cut -d '=' -f2)
USER_NAME=$(grep '^MINIO_ROOT_USER=' .env | cut -d '=' -f2)
USER_PASS=$(grep '^MINIO_ROOT_PASSWORD=' .env | cut -d '=' -f2)

if [ -n "$NGROK_DOMAIN" ]; then
    TUNNEL_URL="https://$NGROK_DOMAIN"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|MINIO_SERVER_URL=.*|MINIO_SERVER_URL=$TUNNEL_URL|" .env
    else
        sed -i "s|MINIO_SERVER_URL=.*|MINIO_SERVER_URL=$TUNNEL_URL|" .env
    fi
else
    TUNNEL_URL="Set NGROK_DOMAIN in .env (e.g. your-name.ngrok-free.app)"
fi

echo ""
echo "========================================================"
echo "   MinIO Storage Stack is RUNNING & READY!"
echo "========================================================"
echo " [Web Console]    : http://localhost:9001"
echo " [Permanent S3 API]: $TUNNEL_URL"
echo " [Ngrok Dashboard] : http://localhost:4040"
echo " [Root User]      : $USER_NAME"
echo " [Root Password]  : $USER_PASS"
echo " [Default Bucket] : app-images (Public Download Active)"
echo "========================================================"
echo " [INFO] Containers are running in background."
echo " To stop anytime, run: ./stop.sh or docker compose down"
echo "========================================================"
echo ""
