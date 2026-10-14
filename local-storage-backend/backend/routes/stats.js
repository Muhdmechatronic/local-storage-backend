import express from 'express';
import { getActiveUserCount, getActiveUsersStats } from '../utils/activeUsers.js';
import { logger } from '../utils/logger.js';
import { getModelManager } from '../services/modelManager/index.js';

const router = express.Router();

/**
 * GET /api/stats/active-users
 * Returns count of currently active users (public endpoint)
 */
router.get('/active-users', (req, res) => {
  const count = getActiveUserCount();
  logger.info(`Active users count requested: ${count}`);

  res.json({
    activeUsers: count,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/stats/active-users/detailed
 * Returns detailed stats about active users (public endpoint)
 */
router.get('/active-users/detailed', (req, res) => {
  const stats = getActiveUsersStats();
  logger.info(`Detailed active users stats requested: ${stats.activeCount} users`);

  res.json(stats);
});

/**
 * GET /api/stats/models
 * Per-model quota usage, status, request counters and queue state (public endpoint)
 */
router.get('/models', async (req, res) => {
  try {
    const manager = await getModelManager();
    res.json({ ...(await manager.getStats()), timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error(`Model stats unavailable: ${error.message}`);
    res.status(503).json({ error: 'Model stats unavailable' });
  }
});

/**
 * GET /api/stats
 * Returns general system stats
 */
router.get('/', (req, res) => {
  const activeCount = getActiveUserCount();

  res.json({
    status: 'ok',
    activeUsers: activeCount,
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    },
    timestamp: new Date().toISOString()
  });
});

export default router;
