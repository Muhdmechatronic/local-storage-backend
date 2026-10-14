import { logger } from '../utils/logger.js';
import { getActiveUserCount } from '../utils/activeUsers.js';

let lastLogTime = 0;
const LOG_INTERVAL = 60 * 1000; // Log active users every 60 seconds

export function requestLogger(req, res, next) {
  const start = Date.now();

  // Log incoming request
  logger.info(`${req.method} ${req.path} - IP: ${req.ip}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? 'error' :
                       res.statusCode >= 300 ? 'warn' : 'success';

    logger[statusColor](`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);

    // Periodically log active user count
    const now = Date.now();
    if (now - lastLogTime > LOG_INTERVAL) {
      lastLogTime = now;
      const activeCount = getActiveUserCount();
      logger.info(`Active users: ${activeCount}`);
    }
  });

  next();
}
