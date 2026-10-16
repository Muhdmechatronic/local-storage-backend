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

#### On Windows — Docker or NO Docker (easiest):
Double-click `start.bat` and choose:
- **[1] With Docker** – the full Docker Compose stack.
- **[2] Without Docker** – for laptops that cannot run Docker. It is chosen automatically when Docker is not installed.

Stop either mode with `stop.bat`.

**No-Docker mode details** (`start-local.bat`, `stop-local.bat`, `logs-local.bat`, `logs-all-local.bat`):
- Nothing needs to be installed first. If Node.js/npm is missing, a portable copy is downloaded into `tools\node` (no admin rights needed).
- On the first run, MinIO is built from source with a temporary Go that is deleted afterwards (MinIO no longer ships free binaries). nginx and ngrok are downloaded into `tools\`. **First run takes about 5–15 minutes**; later runs start in seconds.
- To skip the build on another laptop, copy your `tools\` folder over.
- Same `.env`, same ports as Docker (API via nginx on `8080`, MinIO `9000`/`9001`, ngrok `4040`). The backend runs on `3000`.
- Logs are written to `logs\` (`logs-local.bat` follows the backend log, `logs-all-local.bat` follows every service). Services keep running in the background until `stop.bat`.
- Don't run both modes at the same time, because they use the same ports.

#### Docker only (CMD / PowerShell):
Run:
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

## 📊 View Live Logs (No Rebuild)

Monitor your services in real-time without rebuilding:

#### Backend API Logs Only (Monitor Uploads):
```cmd
logs-backend.bat
```
Shows live logs from the backend API - perfect for monitoring user uploads and API requests.

#### Backend + Nginx Logs:
```cmd
logs.bat
```
Shows backend and nginx proxy logs together.

#### All Services Logs:
```cmd
logs-all.bat
```
Shows logs from all services (backend, minio, nginx, tunnel).

Press `Ctrl+C` to stop viewing logs. Services keep running.

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
