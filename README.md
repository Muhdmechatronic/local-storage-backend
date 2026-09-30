# 🚀 Secure Local S3 Storage & Public Tunnel Setup

An automated, production-ready, local S3-compatible object storage server powered by **MinIO** and exposed over a secure HTTPS public tunnel via **Cloudflare Tunnel (`cloudflared`)**.

This project provides a plug-and-play local S3 environment for **mobile applications (Flutter, React Native, iOS, Android)** and **backend APIs (Node.js, Python, Go)** to upload, store, and publicly serve media assets such as profile pictures, camera captures, and document scans without needing a paid AWS S3 account during development.

---

## ✨ Features & Architecture

- 🗄️ **MinIO S3 Engine:** High-performance, AWS S3-compatible object storage running locally in Docker with persistent disk storage (`minio-data/`).
- 🌐 **Instant Public HTTPS Tunnel:** Integrated Cloudflare Tunnel gives your mobile app or frontend a real `https://*.trycloudflare.com` URL to upload and fetch images from anywhere over the internet.
- 🤖 **Zero-Config Auto-Initialization:** Automated initialization container (`minio-init`) polls the storage engine, creates the default bucket (`app-images`), and configures the public-read download policy.
- ⚡ **1-Click Startup:** Includes cross-platform scripts (`start.bat`, `start.ps1`, `start.sh`) that auto-generate secure credentials and launch the entire stack in seconds.
- 🔒 **Secure by Default:** Secrets and uploaded user files are excluded from Git version control via `.gitignore`.

```text
+-----------------------------------------------------------------------------------+
|                         Docker Compose Stack (storage-net)                        |
|                                                                                   |
|  +--------------------+       +-------------------+       +--------------------+  |
|  |    minio-server    | <----+     minio-init     |       |    minio-tunnel    |  |
|  |  (S3 API & Console)|       | (Auto Bucket Init)|       | (Cloudflare Tunnel)|  |
|  +--------------------+       +-------------------+       +--------------------+  |
|         |        |                                                   |            |
+---------|--------|---------------------------------------------------|------------+
          |        |                                                   |
     Local Ports:  |                                              Public HTTPS:
     :9000 (API)   +---> Web Admin Console                        https://xxxx.trycloudflare.com
                         http://localhost:9001
```

---

## 📋 Prerequisites

Before running this project, make sure you have installed:
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (with Docker Compose v2+)
- **Git**

---

## 🚀 Quick Start / Installation

### 1. Clone the Repository
```bash
git clone https://github.com/Muhd99/your-repo-name.git
cd cloude/local-storage-backend
```

### 2. Launch the Storage Stack (1-Click)

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

When the startup script finishes, your credentials and endpoints will be printed to your terminal:

| Service | URL / Port | Credentials |
| :--- | :--- | :--- |
| **Web Admin Console** | `http://localhost:9001` | Username: `admin`<br>Password: *(in `.env`)* |
| **Local S3 API** | `http://localhost:9000` | Same as above |
| **Public S3 API (Tunnel)** | `https://xxxx.trycloudflare.com` | Same as above |
| **Default Bucket** | `app-images` | Initialized with public read access |

### Retrieving Your Auto-Generated Password:
Your password is automatically stored in `local-storage-backend/.env`. You can view it at any time with:
```powershell
Get-Content local-storage-backend\.env
```

---

## 📱 How to Use in Your Application

### 1. Recommended Image URL Pattern
Because the `app-images` bucket has public-read permissions enabled, any uploaded photo is instantly reachable over HTTPS:
```text
https://<tunnel-url>/app-images/<folder>/<filename>
```
*Example:* `https://xxxx.trycloudflare.com/app-images/profiles/user_123/avatar.jpg`

---

### 2. Quick Upload Examples

#### A. In Mobile App (Flutter / Dart):
```dart
import 'dart:io';
import 'package:http/http.dart' as http;

Future<void> uploadPhoto(File imageFile, String fileName) async {
  final url = Uri.parse('https://<tunnel-url>/app-images/captures/$fileName');
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
  source={{ uri: 'https://<tunnel-url>/app-images/profiles/user_123/avatar.jpg' }}
  style={{ width: 100, height: 100, borderRadius: 50 }}
/>
```

#### C. In Backend API (Node.js / Express):
```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
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
│   ├── docker-compose.yml     # Multi-service stack (MinIO, Init, Cloudflare)
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

## 🔒 Security Notice

- The `.env` file contains sensitive administrative credentials and is **never committed to Git**.
- The `minio-data/` folder contains your persistent media uploads and is **excluded from Git** to prevent repository bloat and data leakage.
- When sharing this project, always use `.env.example` as a reference template.

---

## 📄 License
This project is licensed under the MIT License.
