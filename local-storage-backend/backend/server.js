import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import uploadRoute from './routes/upload.js';
import scanRoute from './routes/scan.js';
import statsRoute from './routes/stats.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { getModelManager, shutdownModelManager } from './services/modelManager/index.js';
import { getFoodOptions, getPublicFoodOptions } from './services/foodOptions.js';

dotenv.config({ path: '../.env' });

// Initialize Firebase Admin (for token verification)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

const app = express();
const PORT = process.env.BACKEND_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

// Fail fast on invalid model-manager config (or unreachable Redis) before accepting traffic
const modelManager = await getModelManager();
// Fail fast on an invalid config/foodOptions.json (categories, health types, meal types)
const foodOptions = getPublicFoodOptions(getFoodOptions({ force: true }));
logger.info(`Food options loaded: ${foodOptions.categories.length} categories, ${foodOptions.healthTypes.length} health types, ${foodOptions.mealTypes.length} meal types`);

// Health check (process liveness + AI model capacity summary)
app.get('/api/health', async (req, res) => {
  const aiModels = await modelManager.health().catch(() => ({ status: 'unknown' }));
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'urbanmove-backend',
    aiModels
  });
});

// Routes
app.use('/api/upload', uploadRoute);
app.use('/api/scan', scanRoute);
app.use('/api/stats', statsRoute);

// Error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.success(`Backend API running on port ${PORT}`);
  logger.info(`Health endpoint: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown: stop accepting connections, reject queued scans, let in-flight scans finish
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn(`${signal} received, shutting down gracefully...`);
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 15000);
  forceExit.unref();

  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    shutdownModelManager(),
  ]);
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
