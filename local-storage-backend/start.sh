#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "========================================================"
echo "   Starting MinIO S3 Secure Storage Stack (Docker)..."
echo "========================================================"

# 1. Initialize .env if missing
if [ ! -f .env ]; then
    echo "[*] .env file not found. Generating secure credentials..."
    RAND_PASS=$(openssl rand -hex 16 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 24 | head -n 1)
    cat <<EOF > .env
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=${RAND_PASS}
MINIO_SERVER_URL=https://api.your-tunnel.com
MINIO_DEFAULT_BUCKET=app-images
EOF
    echo "[+] Created .env with auto-generated root password."
fi

# 2. Launch Docker Compose Stack
echo "[*] Launching Docker Compose stack (minio, minio-init, tunnel)..."
docker compose up -d --build

# 3. Wait for tunnel connection
echo "[*] Waiting for tunnel connection and bucket auto-initialization..."
TUNNEL_URL=""
for i in {1..20}; do
    sleep 2
    LOGS=$(docker logs minio-tunnel 2>&1 || true)
    if echo "$LOGS" | grep -E -q 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'; then
        TUNNEL_URL=$(echo "$LOGS" | grep -E -o 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | head -n 1)
        break
    fi
done

if [ -n "$TUNNEL_URL" ]; then
    echo "[+] Cloudflare Tunnel established: $TUNNEL_URL"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|MINIO_SERVER_URL=.*|MINIO_SERVER_URL=$TUNNEL_URL|" .env
    else
        sed -i "s|MINIO_SERVER_URL=.*|MINIO_SERVER_URL=$TUNNEL_URL|" .env
    fi
else
    TUNNEL_URL="Check 'docker logs minio-tunnel'"
fi

USER_NAME=$(grep '^MINIO_ROOT_USER=' .env | cut -d '=' -f2)
USER_PASS=$(grep '^MINIO_ROOT_PASSWORD=' .env | cut -d '=' -f2)

echo ""
echo "========================================================"
echo "   MinIO Storage Stack is RUNNING & READY!"
echo "========================================================"
echo " [Web Console]   : http://localhost:9001"
echo " [Public S3 API] : $TUNNEL_URL"
echo " [Root User]     : $USER_NAME"
echo " [Root Password] : $USER_PASS"
echo " [Default Bucket]: app-images (Public Download Active)"
echo "========================================================"
echo " [INFO] Containers are running in background."
echo " To stop anytime, run: ./stop.sh or docker compose down"
echo "========================================================"
echo ""
