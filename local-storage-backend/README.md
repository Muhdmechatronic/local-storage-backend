# 🚀 Local MinIO S3 Object Storage & Ngrok Permanent Domain Stack

An automated, self-contained, production-grade local S3 object storage environment with a **permanent static public domain** packaged entirely with Docker Compose.

---

## ⚡ 1-Click Fast Start

### 1. Configure Your Free Ngrok Static Domain
Copy `.env.example` to `.env` (or run `start.bat` to configure interactively):
- Sign up for free at: **[https://dashboard.ngrok.com/signup](https://dashboard.ngrok.com/signup)**
- Get your token at: **[Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)**
- Claim your free domain at: **[Domains](https://dashboard.ngrok.com/domains)** (e.g. `your-name.ngrok-free.app`)

Fill in `.env`:
```env
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=YourPassword123!
MINIO_DEFAULT_BUCKET=app-images

NGROK_AUTHTOKEN=your_ngrok_authtoken
NGROK_DOMAIN=your-claimed-domain.ngrok-free.app
```

### 2. Start the Stack

#### On Windows (CMD / PowerShell):
Double-click `start.bat` or run:
```powershell
.\start.ps1
```

#### On Linux / macOS:
```bash
chmod +x start.sh
./start.sh
```

#### Or Standard Docker Compose:
```bash
docker compose up -d --build
```

---

## 📦 What Happens Automatically on Startup?

1. **Auto-Generates Credentials:** If `.env` is missing, a secure password is created.
2. **MinIO Server:** Starts MinIO S3 API on port `9000` and Web Console on port `9001`.
3. **Automated Bucket Initialization (`minio-init`):**
   - Automatically authenticates with MinIO.
   - Creates the default `app-images` bucket.
   - Sets the public download policy (`mc anonymous set download`) so mobile/web apps can fetch photos and avatars directly without authentication.
4. **Ngrok Tunnel (`minio-tunnel`):**
   - Establishes a permanent static HTTPS tunnel to `http://minio:9000` using your claimed free domain.
   - The URL **never changes across restarts or reboots**.
   - Exposes Ngrok Web Inspector on `http://localhost:4040`.

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
