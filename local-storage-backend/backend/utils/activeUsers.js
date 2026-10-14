import { logger } from './logger.js';

// Store active users in memory
// Format: { userId: { lastActive: timestamp, requestCount: number } }
const activeUsers = new Map();

// Configuration
const ACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes - consider user inactive after this

/**
 * Track user activity
 */
export function trackUserActivity(userId) {
  const now = Date.now();
  const wasActive = activeUsers.has(userId);

  if (activeUsers.has(userId)) {
    const user = activeUsers.get(userId);
    user.lastActive = now;
    user.requestCount++;
  } else {
    activeUsers.set(userId, {
      lastActive: now,
      requestCount: 1,
      firstSeen: now
    });
    logger.info(`New user session started: ${userId.substring(0, 8)}... (Total active: ${getActiveUserCount()})`);
  }
}

/**
 * Clean up inactive users
 */
function cleanupInactiveUsers() {
  const now = Date.now();
  let removedCount = 0;

  for (const [userId, data] of activeUsers.entries()) {
    if (now - data.lastActive > ACTIVITY_TIMEOUT) {
      activeUsers.delete(userId);
      removedCount++;
      logger.info(`User session expired: ${userId.substring(0, 8)}...`);
    }
  }

  if (removedCount > 0) {
    logger.info(`Cleaned up ${removedCount} inactive user session(s). Active users: ${getActiveUserCount()}`);
  }
}

/**
 * Get count of currently active users
 */
export function getActiveUserCount() {
  cleanupInactiveUsers();
  return activeUsers.size;
}

/**
 * Get detailed stats about active users
 */
export function getActiveUsersStats() {
  cleanupInactiveUsers();

  const users = Array.from(activeUsers.entries()).map(([userId, data]) => ({
    userId: userId.substring(0, 8) + '...',
    lastActive: new Date(data.lastActive).toISOString(),
    requestCount: data.requestCount,
    sessionDuration: Math.round((Date.now() - data.firstSeen) / 1000) // seconds
  }));

  return {
    activeCount: activeUsers.size,
    users: users,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get all user IDs (for admin purposes)
 */
export function getAllActiveUserIds() {
  cleanupInactiveUsers();
  return Array.from(activeUsers.keys());
}

// Run cleanup every minute
setInterval(cleanupInactiveUsers, 60 * 1000);

logger.info('Active user tracking initialized (timeout: 5 minutes)');
