// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

function timestamp() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${colors.dim}${hours}:${minutes}:${seconds}${colors.reset}`;
}

export const logger = {
  success: (message) => {
    console.log(`${timestamp()} ${colors.green}${colors.bright}[SUCCESS]${colors.reset} ${message}`);
  },

  error: (message) => {
    console.log(`${timestamp()} ${colors.red}${colors.bright}[ERROR]${colors.reset} ${message}`);
  },

  warn: (message) => {
    console.log(`${timestamp()} ${colors.yellow}${colors.bright}[WARN]${colors.reset} ${message}`);
  },

  info: (message) => {
    console.log(`${timestamp()} ${colors.cyan}${colors.bright}[INFO]${colors.reset} ${message}`);
  },

  debug: (message) => {
    console.log(`${timestamp()} ${colors.magenta}${colors.bright}[DEBUG]${colors.reset} ${message}`);
  },

  auth: (message) => {
    console.log(`${timestamp()} ${colors.blue}${colors.bright}[AUTH]${colors.reset} ${message}`);
  },
};
