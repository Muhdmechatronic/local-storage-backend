# 🚀 Secure Local S3 Storage & Permanent Ngrok Tunnel Setup

An automated, production-ready, local S3-compatible object storage server powered by **MinIO** and exposed over a **permanent, fixed public URL** via **Ngrok Free Static Subdomain**.

This project provides a plug-and-play local S3 environment for **mobile applications (Flutter, React Native, iOS, Android)** and **backend APIs (Node.js, Python, Go)** to upload, store, and publicly serve media assets such as profile pictures, camera captures, and document scans without paying for cloud storage or dealing with changing tunnel URLs.

---

## ✨ Features & Architecture

- 🗄️ **MinIO S3 Engine:** High-performance, AWS S3-compatible object storage running locally in Docker with persistent disk storage (`minio-data/`).
- 🌐 **Permanent Fixed Public Domain:** Free static subdomain from Ngrok (`https://your-domain.ngrok-free.app`) that **never changes across restarts or computer reboots**.
- 🤖 **Zero-Config Auto-Initialization:** Automated initialization container (`minio-init`) polls the storage engine, creates the default bucket (`app-images`), and configures the public-read download policy.
- ⚡ **1-Click Startup:** Includes cross-platform scripts (`start.bat`, `start.ps1`, `start.sh`) with auto-generated credentials and live log viewing.
- 🔒 **Secure by Default:** Secrets, credentials, and uploaded user files are strictly excluded from Git version control via `.gitignore`.

```text
+-----------------------------------------------------------------------------------+
|                         Docker Compose Stack (storage-net)                        |
|                                                                                   |
|  +--------------------+       +-------------------+       +--------------------+  |
|  |    minio-server    | <----+     minio-init     |       |    ngrok-tunnel    |  |
|  |  (S3 API & Console)|       | (Auto Bucket Init)|       |  (Static Domain)   |  |
|  +--------------------+       +-------------------+       +--------------------+  |
|         |        |                                                   |            |
+---------|--------|---------------------------------------------------|------------+
          |        |                                                   |
     Local Ports:  |                                              Permanent HTTPS:
     :9000 (API)   +---> Web Admin Console                        https://your-name.ngrok-free.app
                         http://localhost:9001
```

---

## 📋 Prerequisites

1. **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (with Docker Compose v2+)
2. **Free Ngrok Account:**
   - Sign up at: **[https://dashboard.ngrok.com/signup](https://dashboard.ngrok.com/signup)**
   - Copy your authtoken from **[Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)**
   - Claim your free permanent domain from **[Domains](https://dashboard.ngrok.com/domains)** (e.g. `your-app.ngrok-free.app`)

---

## 🚀 Quick Start / Installation

### 1. Clone the Repository
```bash
git clone https://github.com/Muhdmechatronic/local-storage-backend.git
cd local-storage-backend/local-storage-backend
```

### 2. Configure Your Free Ngrok Static Domain
Copy `.env.example` to `.env` (or run `start.bat` to configure interactively):
```env
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=YourSecurePassword123!
MINIO_DEFAULT_BUCKET=app-images

NGROK_AUTHTOKEN=your_token_from_ngrok_dashboard
NGROK_DOMAIN=your-claimed-domain.ngrok-free.app
```

### 3. Launch the Storage Stack (1-Click)

#### On Windows (PowerShell or Command Prompt):
```powershell
.\start.ps1
# or double-click start.bat
```

#### On Linux / macOS (Bash):
```bash
chmod +x start.sh
./start.sh
```

#### Or Using Docker Compose Directly:
```bash
docker compose up -d --build
```

---

## 🔑 Access Details & Credentials

When the startup script finishes, your endpoints and credentials will be displayed in the terminal:

| Service | URL / Port | Credentials |
| :--- | :--- | :--- |
| **Web Admin Console** | `http://localhost:9001` | Username: `admin`<br>Password: *(in `.env`)* |
| **Permanent S3 API (Public)** | `https://your-domain.ngrok-free.app` | Same as above |
| **Local S3 API** | `http://localhost:9000` | Same as above |
| **Ngrok Web Inspector** | `http://localhost:4040` | Inspect live HTTP requests |
| **Default Bucket** | `app-images` | Initialized with public read access |

---

## 📱 How to Use in Your Application

### 1. Recommended Image URL Pattern
Because the `app-images` bucket has public-read permissions enabled, any uploaded photo is instantly reachable over HTTPS:
```text
https://your-domain.ngrok-free.app/app-images/<folder>/<filename>
```
*Example:* `https://your-domain.ngrok-free.app/app-images/profiles/user_123/avatar.jpg`

---

### 2. Quick Upload Examples

#### A. In Mobile App (Flutter / Dart):
```dart
import 'dart:io';
import 'package:http/http.dart' as http;

Future<void> uploadPhoto(File imageFile, String fileName) async {
  final url = Uri.parse('https://your-domain.ngrok-free.app/app-images/captures/$fileName');
  final bytes = await imageFile.readAsBytes();

  final response = await http.put(
    url,
    headers: {'Content-Type': 'image/jpeg'},
    body: bytes,
  );

  if (response.statusCode == 200) {
    print('Photo uploaded successfully! Public URL: $url');
  }
}
```

#### B. In Mobile App (React Native / Expo):
```javascript
<Image
  source={{ uri: 'https://your-domain.ngrok-free.app/app-images/profiles/user_123/avatar.jpg' }}
  style={{ width: 100, height: 100, borderRadius: 50 }}
/>
```

#### C. In Backend API (Node.js / Express):
```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.MINIO_SERVER_URL || "http://localhost:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER || "admin",
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
  },
  forcePathStyle: true,
});
```

👉 **For the full implementation guide with camera capture, backend APIs, and presigned URLs, check [INTEGRATION_GUIDE.md](./local-storage-backend/INTEGRATION_GUIDE.md).**

---

## 🛑 Stopping the Stack

To stop the containers gracefully:

```powershell
.\stop.ps1
# or
docker compose down
```

---

## 📁 Repository Structure

```text
.
├── local-storage-backend/
│   ├── init/
│   │   ├── Dockerfile         # Auto-initialization container definition
│   │   └── init.sh            # Bucket creation & policy automation script
│   ├── minio/
│   │   └── Dockerfile         # Self-contained MinIO Server build definition
│   ├── docker-compose.yml     # Multi-service stack (MinIO, Init, Ngrok)
│   ├── .env.example           # Configuration template
│   ├── .gitignore             # Prevents committing .env and media data
│   ├── start.ps1              # 1-Click launcher (PowerShell)
│   ├── start.bat              # 1-Click launcher (Windows CMD)
│   ├── start.sh               # 1-Click launcher (Linux/macOS)
│   ├── stop.ps1               # 1-Click stop (PowerShell)
│   ├── stop.bat               # 1-Click stop (Windows CMD)
│   ├── README.md              # Backend stack overview
│   └── INTEGRATION_GUIDE.md   # Complete Flutter / React Native / Node / Python tutorial
├── .gitignore                 # Root repository ignore rules
└── README.md                  # Main project documentation
```

---

## 📄 License
This project is licensed under the MIT License.
