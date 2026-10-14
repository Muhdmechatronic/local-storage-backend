# UrbanMove Backend API Setup Guide

## Overview

This Docker setup includes:
- **MinIO** - S3-compatible object storage (port 9000, console 9001)
- **Backend API** - Node.js/Express API server (port 3000)
- **Nginx** - Reverse proxy routing /api/* to backend and /* to MinIO
- **Ngrok** - Exposes nginx through a single public domain

## Architecture

```
ngrok (https://your-domain.ngrok-free.app)
  ↓
nginx (reverse proxy on port 80)
  ├─ /api/* → Backend API (port 3000)
  │   ├─ POST /api/upload (secure image upload)
  │   ├─ DELETE /api/upload (delete image)
  │   └─ POST /api/scan (Gemini food scan)
  └─ /* → MinIO (port 9000)
      └─ Direct file access
```

## Prerequisites

1. Docker Desktop installed
2. Ngrok account with static domain
3. Firebase project with Admin SDK credentials
4. Google Gemini API key

## Step 1: Configure Environment Variables

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set these values:

### MinIO Credentials
```bash
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=YourSecurePassword123!
MINIO_DEFAULT_BUCKET=app-images
```

### Ngrok Configuration
```bash
NGROK_AUTHTOKEN=your_actual_ngrok_authtoken
NGROK_DOMAIN=your-static-domain.ngrok-free.app
MINIO_SERVER_URL=https://your-static-domain.ngrok-free.app
```

### Gemini API Key
Get from: https://makersuite.google.com/app/apikey
```bash
GEMINI_API_KEY=AIza...your_actual_key
```

### Firebase Admin Credentials
Get from: Firebase Console > Project Settings > Service Accounts > Generate new private key

Download the JSON file and extract:
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"
```

**Important:** Keep the quotes and newlines (`\n`) in FIREBASE_PRIVATE_KEY

## Step 2: Install Backend Dependencies

```powershell
cd backend
npm install
cd ..
```

## Step 3: Build and Start Services

```powershell
# PowerShell
.\start.ps1
```

Or manually:
```powershell
docker-compose up --build -d
```

## Step 4: Verify Services

Check all services are running:
```powershell
docker-compose ps
```

You should see:
- minio-server (healthy)
- minio-init (exited after bucket creation)
- urbanmove-backend (healthy)
- nginx-proxy (healthy)
- minio-tunnel (healthy)

### Test Endpoints

**Nginx Health:**
```powershell
curl http://localhost:8080/health
```

**Backend API Health:**
```powershell
curl http://localhost:8080/api/health
```

**Via Ngrok (public):**
```powershell
curl https://your-domain.ngrok-free.app/api/health
```

## Step 5: Mobile App Configuration

Update your Flutter app's `.env`:

```bash
# Remove these (moved to backend)
# MINIO_ENDPOINT=...
# MINIO_ACCESS_KEY=...
# MINIO_SECRET_KEY=...
# GEMINI_API_KEY=...

# Keep only:
MAPS_API_KEY=your-maps-key
BACKEND_URL=https://your-domain.ngrok-free.app
```

## API Endpoints

### POST /api/upload
Upload an image to MinIO

**Headers:**
```
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "fileName": "profile.jpg",
  "fileData": "base64-encoded-image-data",
  "fileType": "image/jpeg"
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://your-domain.ngrok-free.app/app-images/users/userId/timestamp_profile.jpg",
  "fileName": "users/userId/timestamp_profile.jpg",
  "size": 123456
}
```

### DELETE /api/upload
Delete an uploaded image

**Headers:**
```
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "fileName": "users/userId/timestamp_profile.jpg"
}
```

### POST /api/scan
Scan food image with Gemini AI

**Headers:**
```
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "imageBase64": "base64-encoded-image-data"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "candidates": [...],
    "...": "Gemini API response"
  },
  "model": "gemini-3.1-flash-lite"
}
```

**Error responses** (`{ error, code, message, retryAfterSeconds?, resetAt? }`, with a `Retry-After` header when retrying makes sense):

| Status | code | Meaning |
|--------|------|---------|
| 429 | `DAILY_QUOTA_EXHAUSTED` | Every model used its daily quota; `resetAt` = next reset (midnight Pacific) |
| 503 | `QUEUE_FULL` / `QUEUE_TIMEOUT` / `CAPACITY_UNAVAILABLE` | All models busy this minute; retry after `retryAfterSeconds` |
| 502 | `RETRIES_EXHAUSTED` | Provider kept failing (5xx / timeouts) after bounded retries |
| 504 | `DEADLINE_EXCEEDED` | Scan exceeded the request deadline |
| 400 | `BAD_REQUEST` | Provider rejected the image/request (not retried) |
| 500 | `PROVIDER_AUTH` | Gemini API key invalid or missing (not retried) |

#### Scan model load balancer

`backend/services/modelManager/` spreads scans **round-robin across all models** (no primary model), each with its own quota (default 15 requests/min, 150/day):

- **Quotas:** every call first reserves a slot atomically (sliding 60s window + daily counter that resets at midnight Pacific, matching Gemini). Limits are never exceeded, even with concurrent users.
- **Failover:** a model that hits a limit, returns 429 (honours `Retry-After` / Gemini `RetryInfo`), or returns 404 (retired model) is skipped and automatically reintroduced when it becomes eligible again.
- **Models that are down:** after 3 consecutive 5xx/timeouts/network errors a model's circuit opens for 60s. After that, a single trial request is allowed; success restores it, failure re-opens it.
- **Queueing:** when every model is at its minute limit, requests wait in a FIFO queue (50 slots, 30s) and resume automatically. When every daily quota is used, requests fail fast with `DAILY_QUOTA_EXHAUSTED`.
- **Retries:** bounded (4 attempts, 60s deadline, 25s per attempt) with exponential backoff + jitter. Auth and bad-request errors are never retried.
- **Multiple instances:** the default in-memory quota store is correct for one backend process (the current setup). If you run several replicas/workers, set `QUOTA_STORE=redis` and `REDIS_URL` so they share quotas (uses the optional `redis` package).

All settings are environment variables (see `.env.example`).

**Measured capacity** (`npm run simulate`, mock provider with 5-10s replies, 8 models, default settings; target ≥99% success and p95 ≤30s):

| Scenario | Max users meeting target |
|----------|--------------------------|
| Burst: N users press scan at the same moment | 100 (150 → 21% rejected with "retry shortly") |
| Sustained: users scanning every 30-90s | 150 |
| Same, with 2 of 8 models down (one hanging, one 503) | 100 |

Hard limits: **120 scans/minute** and **1,200 scans/day** across all models.

**Testing (never calls the real API):**
```bash
cd backend
npm test            # automated tests (node:test, mock provider)
npm run simulate    # capacity profile: burst / sustained / outage
```

### GET /api/scan/options
Category, health type and meal type lists used by the app's pickers (public):
```json
{ "version": 1, "categories": ["Rice & Grain", "...", "Other"], "healthTypes": ["Healthy", "Moderate", "Junk Food"],
  "mealTypes": ["Breakfast", "..."], "defaults": { "category": "Other", "healthType": "Moderate", "mealType": "Lunch" } }
```

#### Changing food categories (no app update needed)
Edit `backend/config/foodOptions.json`. The same file drives:
- the AI prompt (category/type lists, rules, descriptions and examples),
- the cleanup of AI replies (`aliases` = words that map to a category, e.g. "beverage" → Drinks),
- the lists the app shows (fetched from `/api/scan/options`, cached on the phone).

With Docker, `backend/config` is mounted into the container, so saved changes apply within ~5 seconds; no rebuild or restart. An invalid edit (bad JSON, duplicate name, unknown default) is rejected and the previous version stays active; check `logs-backend.bat` for `[food-options]`. Saved food logs keep their old category even if it is renamed later.

### GET /api/stats/models
Per-model quota usage, status (`available`, `minute_limited`, `rate_limited`, `unhealthy`, `disabled`, `daily_exhausted`), request counters and queue state. `/api/health` also includes an `aiModels` summary.

### GET /api/stats
Get general system statistics

**No authentication required**

**Response:**
```json
{
  "status": "ok",
  "activeUsers": 5,
  "uptime": 3600,
  "memory": {
    "used": 45,
    "total": 128,
    "unit": "MB"
  },
  "timestamp": "2026-10-06T09:42:15.000Z"
}
```

### GET /api/stats/active-users
Get count of currently active users

**No authentication required**

**Response:**
```json
{
  "activeUsers": 5,
  "timestamp": "2026-10-06T09:42:15.000Z"
}
```

### GET /api/stats/active-users/detailed
Get detailed statistics about active users

**No authentication required**

**Response:**
```json
{
  "activeCount": 2,
  "users": [
    {
      "userId": "abc12345...",
      "lastActive": "2026-10-06T09:42:10.000Z",
      "requestCount": 15,
      "sessionDuration": 300
    }
  ],
  "timestamp": "2026-10-06T09:42:15.000Z"
}
```

## Docker Commands

**Start all services:**
```powershell
docker-compose up -d
```

**Stop all services:**
```powershell
docker-compose down
```

**View logs:**
```powershell
# Quick log viewing scripts (no rebuild)
logs-backend.bat      # Backend API only (best for monitoring uploads)
logs.bat              # Backend + Nginx
logs-all.bat          # All services

# Or use docker-compose directly
docker-compose logs -f backend
docker-compose logs -f nginx
docker-compose logs -f minio
```

**Rebuild after code changes:**
```powershell
docker-compose up --build -d
```

**Restart a specific service:**
```powershell
docker-compose restart backend
```

## Troubleshooting

### Backend won't start
Check logs:
```powershell
docker-compose logs backend
```

Common issues:
- Missing `.env` file → Copy from `.env.example`
- Invalid Firebase credentials → Check FIREBASE_PRIVATE_KEY format
- Port 3000 already in use → Change BACKEND_PORT in docker-compose.yml

### Can't connect to backend from mobile app
1. Check ngrok is running:
   ```powershell
   docker-compose logs tunnel
   ```
2. Visit ngrok dashboard: http://localhost:4040
3. Verify domain matches BACKEND_URL in mobile app
4. Test endpoint: `curl https://your-domain.ngrok-free.app/api/health`

### Upload fails with 401 Unauthorized
- Verify Firebase Auth token is valid and not expired
- Check FIREBASE_PROJECT_ID matches your Firebase project
- Ensure user is authenticated in mobile app

### Upload fails with 500 error
- Check MinIO is running: `docker-compose ps minio`
- Verify MINIO_ROOT_USER and MINIO_ROOT_PASSWORD
- Check backend logs: `docker-compose logs backend`

### Nginx 502 Bad Gateway
- Backend might not be ready yet, wait 10 seconds
- Restart nginx: `docker-compose restart nginx`
- Check backend health: `curl http://localhost:3000/api/health`

## Development

To develop backend locally (outside Docker):

1. Stop Docker backend:
   ```powershell
   docker-compose stop backend
   ```

2. Run locally:
   ```powershell
   cd backend
   npm run dev
   ```

3. Access at: `http://localhost:3000/api/health`

Note: MinIO must still run in Docker for local development.

## Security Checklist

- [ ] Changed MINIO_ROOT_PASSWORD from default
- [ ] Firebase private key stored securely in `.env`
- [ ] `.env` file is in `.gitignore`
- [ ] Ngrok domain is static (not random)
- [ ] Firebase Auth tokens verified on every request
- [ ] File upload size limited to 5MB
- [ ] Only allowed file types (jpeg, png) accepted

## Monitoring

**Live Logs (No Rebuild):**
Run `logs-backend.bat` to see real-time API activity:
- User uploads with file size and user ID
- API requests and responses
- Authentication events
- Active user count (updated every minute)
- Color-coded: [SUCCESS] green, [ERROR] red, [WARN] yellow, [INFO] cyan

**Active Users API:**
```powershell
# Current active user count
curl http://localhost:8080/api/stats/active-users

# Detailed user session stats
curl http://localhost:8080/api/stats/active-users/detailed

# General system stats
curl http://localhost:8080/api/stats
```

Users are considered active for 5 minutes after their last API request.

**Ngrok Dashboard:**
http://localhost:4040

View:
- Active tunnels
- Request/response logs
- Traffic metrics

**MinIO Console:**
http://localhost:9001

Credentials:
- Username: Value of MINIO_ROOT_USER
- Password: Value of MINIO_ROOT_PASSWORD

## Cost Breakdown

- Docker: Free
- Ngrok free tier: 1 static domain, 40 connections/minute
- Gemini API: Free tier (60 requests/minute)
- MinIO: Free (self-hosted)
- Firebase Auth: Free

Total monthly cost: $0

Last Updated: October 6, 2026
