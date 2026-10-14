import admin from 'firebase-admin';
import { logger } from '../utils/logger.js';
import { trackUserActivity } from '../utils/activeUsers.js';

export async function verifyAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header'
      });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    // Track user activity
    trackUserActivity(req.user.uid);

    logger.auth(`User authenticated: ${req.user.uid.substring(0, 8)}...`);
    next();
  } catch (error) {
    logger.error(`Auth failed: ${error.message}`);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
}
