# 🚀 Local MinIO S3 Object Storage & Cloudflare Tunnel Stack

An automated, self-contained, production-grade local S3 object storage environment packaged entirely with Docker Compose.

---

## ⚡ 1-Click Fast Start

### On Windows (CMD / PowerShell):
Double-click `start.bat` or run:
```powershell
.\start.ps1
```

### On Linux / macOS:
```bash
chmod +x start.sh
./start.sh
```

### Or Standard Docker Compose:
```bash
docker compose up -d --build
```

---

## 📦 What Happens Automatically on Startup?

1. **Auto-Generates Credentials:** If `.env` is missing, a secure 24-character random password is automatically generated.
2. **MinIO Server:** Starts MinIO S3 API on port `9000` and Web Console on port `9001`.
3. **Automated Bucket Initialization (`minio-init`):**
   - Automatically authenticates with MinIO.
   - Creates the default `app-images` bucket.
   - Sets the public download policy (`mc anonymous set download`) so mobile/web apps can fetch photos and avatars directly without authentication.
4. **Cloudflare Tunnel (`minio-tunnel`):**
   - Establishes a secure HTTPS tunnel to the MinIO API.
   - Dynamically updates `MINIO_SERVER_URL` in `.env`.
   - Displays your public HTTPS S3 Endpoint in the terminal.

---

## 🛑 Stopping the Stack

```powershell
.\stop.ps1
# or
docker compose down
```

---

## 📖 Application Integration Tutorial
For complete code examples in **Flutter, React Native, Node.js (Express/TypeScript), and Python (FastAPI/Flask)**, see:
👉 [**`INTEGRATION_GUIDE.md`**](./INTEGRATION_GUIDE.md)
