import express from 'express';
import { Client } from 'minio';
import { verifyAuth } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Initialize MinIO client (using Docker service name)
const minioClient = new Client({
  endPoint: 'minio',  // Docker service name
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER,
  secretKey: process.env.MINIO_ROOT_PASSWORD,
});

router.post('/', verifyAuth, async (req, res) => {
  try {
    const { fileName, fileData, fileType } = req.body;
    const userId = req.user.uid;

    // Log upload start
    logger.info(`Upload request from user: ${userId.substring(0, 8)}... (${fileName})`);

    // Validate input
    if (!fileName || !fileData) {
      logger.warn(`Upload rejected: Missing fileName or fileData (user: ${userId.substring(0, 8)}...)`);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing fileName or fileData'
      });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (fileType && !allowedTypes.includes(fileType)) {
      logger.warn(`Upload rejected: Invalid file type ${fileType} (user: ${userId.substring(0, 8)}...)`);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid file type. Allowed: jpeg, png, jpg'
      });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (buffer.length > maxSize) {
      const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
      logger.warn(`Upload rejected: File too large ${sizeMB}MB (user: ${userId.substring(0, 8)}...)`);
      return res.status(400).json({
        error: 'Bad Request',
        message: `File too large. Max size: ${maxSize / 1024 / 1024}MB`
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const objectName = `users/${userId}/${timestamp}_${sanitizedFileName}`;

    const bucket = process.env.MINIO_DEFAULT_BUCKET || 'app-images';

    // Upload to MinIO
    await minioClient.putObject(
      bucket,
      objectName,
      buffer,
      buffer.length,
      { 'Content-Type': fileType || 'image/jpeg' }
    );

    // Generate public URL (use ngrok domain if available)
    const publicEndpoint = process.env.MINIO_SERVER_URL || 'http://localhost:9000';
    const url = `${publicEndpoint}/${bucket}/${objectName}`;

    // Log successful upload
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    logger.success(`Upload completed: ${sizeMB}MB - ${sanitizedFileName} (user: ${userId.substring(0, 8)}...)`);

    res.json({
      success: true,
      url: url,
      fileName: objectName,
      size: buffer.length,
    });
  } catch (error) {
    logger.error(`Upload failed for user ${req.user?.uid?.substring(0, 8)}...: ${error.message}`);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message
    });
  }
});

// Delete uploaded file
router.delete('/', verifyAuth, async (req, res) => {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing fileName'
      });
    }

    // Verify user owns this file
    const userId = req.user.uid;
    if (!fileName.startsWith(`users/${userId}/`)) {
      logger.warn(`User ${userId} attempted to delete file they don't own: ${fileName}`);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only delete your own files'
      });
    }

    const bucket = process.env.MINIO_DEFAULT_BUCKET || 'app-images';
    await minioClient.removeObject(bucket, fileName);

    logger.info(`File deleted: ${fileName}`);

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error) {
    logger.error(`Delete failed for user ${req.user?.uid}: ${error.message}`);
    res.status(500).json({
      error: 'Delete failed',
      message: error.message
    });
  }
});

export default router;
