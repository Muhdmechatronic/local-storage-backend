# MinIO S3 Storage Integration Guide for Mobile & Web Applications

This guide provides step-by-step instructions and production-ready code examples to connect your application (Mobile, Frontend, or Backend API) to your local MinIO S3 storage to save and display **captured images, profile pictures, and media assets**.

---

## 1. Storage Architecture & Credentials

### Connection Parameters
Keep these credentials in your application's environment configuration (`.env`):

| Parameter | Value | Description |
| :--- | :--- | :--- |
| **S3 Endpoint** | `https://folder-satellite-const-host.trycloudflare.com` | Public Cloudflare Tunnel URL |
| **Local Endpoint** | `http://localhost:9000` | Used when testing backend locally |
| **Web Console UI** | `http://localhost:9001` | Browser Admin Console |
| **Access Key** | `admin` | MinIO Root User |
| **Secret Key** | `78f7683c017046c1b6387842c56be2b2` | MinIO Root Password |
| **Default Bucket** | `app-images` | Initialized with public-read download access |
| **Region** | `us-east-1` | Standard S3 default |
| **S3 Force Path Style** | `true` | Required for MinIO / self-hosted S3 |

---

## 2. Recommended Folder Hierarchy in `app-images`

Organize your bucket using folder prefixes (object keys) so files stay structured:

```text
app-images/
├── profiles/
│   └── user_12345/
│       └── avatar.jpg
├── captures/
│   └── user_12345/
│       ├── 2026-09-30_184500_scan.jpg
│       └── 2026-09-30_184510_photo.png
└── thumbnails/
    └── user_12345/
        └── avatar_small.jpg
```

### Public Image URL Format
Since the `app-images` bucket has public-read access enabled, any uploaded image is immediately viewable in mobile apps or browsers at:
```
https://folder-satellite-const-host.trycloudflare.com/app-images/<folder>/<filename>
```
**Example:**
`https://folder-satellite-const-host.trycloudflare.com/app-images/profiles/user_12345/avatar.jpg`

---

## 3. How to Upload Images (All Methods)

### Method 1: Web Console GUI (Manual Drag & Drop)
1. Open **[http://localhost:9001](http://localhost:9001)** in your browser.
2. Sign in with:
   - **Username:** `admin`
   - **Password:** `78f7683c017046c1b6387842c56be2b2`
3. Click on **Buckets** in the left sidebar and select **`app-images`**.
4. Click **Upload** -> **Upload File** (or drag and drop your image directly into the browser window).
5. The image is now uploaded and publicly accessible at `https://folder-satellite-const-host.trycloudflare.com/app-images/<filename>`.

---

### Method 2: MinIO Client CLI (`mc.exe`)
From your terminal using the pre-compiled binary:

```powershell
# Upload a single profile image
e:\yamanashi\urban-move\cloude\bin\mc.exe cp C:\path\to\my_avatar.jpg myminio/app-images/profiles/user_101/avatar.jpg

# Upload an entire directory of captures
e:\yamanashi\urban-move\cloude\bin\mc.exe cp --recursive C:\path\to\captures\ myminio/app-images/captures/
```

---

### Method 3: Direct HTTP PUT via cURL / Postman
You can upload an image binary directly to the bucket:

```bash
curl -X PUT \
  -T "./camera_photo.jpg" \
  -H "Content-Type: image/jpeg" \
  https://folder-satellite-const-host.trycloudflare.com/app-images/captures/user_101/photo.jpg
```

---

### Method 4: In Python (boto3)

```python
import boto3
from botocore.client import Config

# 1. Initialize S3 client
s3 = boto3.client(
    "s3",
    endpoint_url="https://folder-satellite-const-host.trycloudflare.com",
    aws_access_key_id="admin",
    aws_secret_access_key="78f7683c017046c1b6387842c56be2b2",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    region_name="us-east-1"
)

# 2. Upload file
with open("local_photo.jpg", "rb") as image_file:
    s3.put_object(
        Bucket="app-images",
        Key="captures/user_123/scan_001.jpg",
        Body=image_file,
        ContentType="image/jpeg"
    )

print("Uploaded! Public URL: https://folder-satellite-const-host.trycloudflare.com/app-images/captures/user_123/scan_001.jpg")
```

---

### Method 5: In Node.js / TypeScript (@aws-sdk/client-s3)

```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";

const s3 = new S3Client({
  endpoint: "https://folder-satellite-const-host.trycloudflare.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: "admin",
    secretAccessKey: "78f7683c017046c1b6387842c56be2b2",
  },
  forcePathStyle: true,
});

export async function uploadImage(filePath, s3Key) {
  const fileStream = fs.createReadStream(filePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: "app-images",
      Key: s3Key,
      Body: fileStream,
      ContentType: "image/jpeg",
    })
  );

  return `https://folder-satellite-const-host.trycloudflare.com/app-images/${s3Key}`;
}
```

---

### Method 6: Mobile Client Direct Upload (Flutter / Dart)

```dart
import 'dart:io';
import 'package:http/http.dart' as http;

Future<String?> uploadCapturedImageDirectly(File imageFile, String s3Key) async {
  final url = Uri.parse(
    'https://folder-satellite-const-host.trycloudflare.com/app-images/$s3Key'
  );

  final bytes = await imageFile.readAsBytes();

  final response = await http.put(
    url,
    headers: {
      'Content-Type': 'image/jpeg',
    },
    body: bytes,
  );

  if (response.statusCode == 200) {
    print('Uploaded successfully!');
    return url.toString();
  } else {
    print('Upload failed: ${response.statusCode}');
    return null;
  }
}
```

---

## 4. Backend API Implementation Examples

### Option A: Node.js / TypeScript (Express / NestJS / Fastify)

Install the official AWS SDK v3 client:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner multer
```

#### S3 Client Configuration (`s3Client.js`):
```javascript
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || "https://folder-satellite-const-host.trycloudflare.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER || "admin",
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD || "78f7683c017046c1b6387842c56be2b2",
  },
  forcePathStyle: true, // Crucial for MinIO
});

const BUCKET_NAME = "app-images";

/**
 * 1. Upload Buffer / File directly from Backend
 */
export async function uploadImageToMinIO(fileBuffer, mimeType, s3Key) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  await s3.send(command);

  // Return the public URL
  return `${process.env.S3_ENDPOINT}/${BUCKET_NAME}/${s3Key}`;
}

/**
 * 2. Generate a Presigned Upload URL for Mobile Direct-Upload
 */
export async function getPresignedUploadUrl(s3Key, mimeType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: mimeType,
  });

  // Valid for 15 minutes
  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  const publicUrl = `${process.env.S3_ENDPOINT}/${BUCKET_NAME}/${s3Key}`;

  return { uploadUrl: presignedUrl, publicUrl, key: s3Key };
}
```

#### Express API Routes (`server.js`):
```javascript
import express from "express";
import multer from "multer";
import { uploadImageToMinIO, getPresignedUploadUrl } from "./s3Client.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

// 1. Upload Profile Picture Endpoint
app.post("/api/users/:userId/avatar", upload.single("image"), async (req, res) => {
  try {
    const { userId } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No image file provided" });

    const key = `profiles/${userId}/avatar_${Date.now()}.jpg`;
    const publicUrl = await uploadImageToMinIO(file.buffer, file.mimetype, key);

    // Save publicUrl to your database (Postgres/MySQL/MongoDB)
    res.json({ success: true, avatarUrl: publicUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Upload Captured Camera Image Endpoint
app.post("/api/captures/upload", upload.single("image"), async (req, res) => {
  try {
    const { userId, category } = req.body;
    const file = req.file;
    const key = `captures/${userId || 'guest'}/${category || 'general'}_${Date.now()}.jpg`;

    const publicUrl = await uploadImageToMinIO(file.buffer, file.mimetype, key);
    res.json({ success: true, imageUrl: publicUrl, key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Request Direct Presigned URL (For high-speed mobile uploads)
app.post("/api/media/presigned-url", async (req, res) => {
  try {
    const { fileName, mimeType, folder } = req.body;
    const key = `${folder || "captures"}/${Date.now()}_${fileName}`;
    const result = await getPresignedUploadUrl(key, mimeType || "image/jpeg");
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log("Backend API listening on port 3000"));
```

---

### Option B: Python (FastAPI / Flask)

Install packages:
```bash
pip install boto3 python-multipart fastapi uvicorn
```

#### FastAPI Code (`main.py`):
```python
import os
import time
import boto3
from botocore.client import Config
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse

app = FastAPI()

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "https://folder-satellite-const-host.trycloudflare.com")
BUCKET_NAME = "app-images"

s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=os.getenv("MINIO_ROOT_USER", "admin"),
    aws_secret_access_key=os.getenv("MINIO_ROOT_PASSWORD", "78f7683c017046c1b6387842c56be2b2"),
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    region_name="us-east-1"
)

@app.post("/api/upload/profile-picture")
async def upload_profile_picture(user_id: str = Form(...), file: UploadFile = File(...)):
    key = f"profiles/{user_id}/avatar_{int(time.time())}.jpg"
    contents = await file.read()
    
    s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=key,
        Body=contents,
        ContentType=file.content_type
    )
    
    public_url = f"{S3_ENDPOINT}/{BUCKET_NAME}/{key}"
    return {"status": "success", "avatar_url": public_url}

@app.post("/api/upload/capture")
async def upload_capture(user_id: str = Form("anonymous"), file: UploadFile = File(...)):
    key = f"captures/{user_id}/capture_{int(time.time())}.jpg"
    contents = await file.read()
    
    s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=key,
        Body=contents,
        ContentType=file.content_type
    )
    
    public_url = f"{S3_ENDPOINT}/{BUCKET_NAME}/{key}"
    return {"status": "success", "image_url": public_url}
```

---

## 5. Mobile & Frontend Integration (Capture, Upload & Display)

### 1. Flutter (Dart) Multipart Upload

```dart
import 'dart:io';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:image_picker/image_picker.dart';

Future<String?> captureAndUploadProfile(String userId) async {
  // Pick / Capture Image from Camera
  final picker = ImagePicker();
  final pickedFile = await picker.pickImage(source: ImageSource.camera);

  if (pickedFile == null) return null;

  var uri = Uri.parse("https://your-api-domain.com/api/users/$userId/avatar");
  var request = http.MultipartRequest("POST", uri);

  request.files.add(await http.MultipartFile.fromPath(
    'image',
    pickedFile.path,
  ));

  var streamedResponse = await request.send();
  var response = await http.Response.fromStream(streamedResponse);

  if (response.statusCode == 200) {
    var data = jsonDecode(response.body);
    return data['avatarUrl']; // Returns public URL in MinIO
  }
  return null;
}
```

### 2. React Native / Expo Capture & Upload

```javascript
import * as ImagePicker from 'expo-image-picker';

async function captureAndUploadPhoto(userId) {
  // 1. Capture from Camera
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    quality: 0.8,
  });

  if (result.canceled) return;

  const photo = result.assets[0];

  // 2. Prepare Multipart Form
  const formData = new FormData();
  formData.append('userId', userId);
  formData.append('image', {
    uri: photo.uri,
    name: 'capture.jpg',
    type: 'image/jpeg',
  });

  // 3. Send to Backend API
  const response = await fetch('https://your-api-domain.com/api/captures/upload', {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  const json = await response.json();
  return json.imageUrl;
}
```

---

## 6. Displaying Images in Mobile UI

Because `app-images` is set with public read policy, simply pass the URL directly into standard image components:

#### Flutter:
```dart
Image.network(
  'https://folder-satellite-const-host.trycloudflare.com/app-images/profiles/user_12345/avatar.jpg',
  fit: BoxFit.cover,
  loadingBuilder: (context, child, progress) {
    if (progress == null) return child;
    return Center(child: CircularProgressIndicator());
  },
  errorBuilder: (context, error, stackTrace) => Icon(Icons.person, size: 50),
);
```

#### React Native / React:
```jsx
<Image
  source={{ uri: 'https://folder-satellite-const-host.trycloudflare.com/app-images/profiles/user_12345/avatar.jpg' }}
  style={{ width: 100, height: 100, borderRadius: 50 }}
/>
```

---

## 7. Managing Buckets & Files with CLI (`mc`)

MinIO client binary is preconfigured at `e:\yamanashi\urban-move\cloude\bin\mc.exe`:

```powershell
# List all files in the bucket
.\bin\mc.exe ls myminio/app-images

# List files inside a specific folder
.\bin\mc.exe ls myminio/app-images/profiles/

# Upload a file manually
.\bin\mc.exe cp my_photo.jpg myminio/app-images/captures/

# Remove a file
.\bin\mc.exe rm myminio/app-images/captures/sample_photo.jpg
```

---

## 8. Production Checklist

1. **Persistent Tunnel:**
   - The current Cloudflare Quick Tunnel URL (`https://folder-satellite-const-host.trycloudflare.com`) is ideal for active development and testing.
   - For a permanent, static domain (e.g., `s3.yourcompany.com`), create a free Cloudflare account and use a named tunnel (`cloudflared tunnel create minio-tunnel`).
2. **File Name Uniqueness:**
   - Always append a timestamp or UUID (e.g. `uuidv4()`) to uploaded files to avoid cache collision in mobile apps.
3. **Data Backups:**
   - The files are stored persistently on your host machine inside `local-storage-backend/minio-data`. You can back up this folder at any time.
