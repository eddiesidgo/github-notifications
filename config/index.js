/**
 * Application configuration.
 * Sensitive values come from environment variables (.env) — never hardcode secrets.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const config = {
  appName: 'GitPushNotifier',
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    /**
     * Loopback redirect used by the desktop OAuth flow.
     * Must match a callback URL registered in the GitHub OAuth App settings.
     */
    redirectUri: process.env.GITHUB_REDIRECT_URI || 'http://127.0.0.1:42813/callback',
    oauthAuthorizeUrl: 'https://github.com/login/oauth/authorize',
    oauthTokenUrl: 'https://github.com/login/oauth/access_token',
    apiBaseUrl: 'https://api.github.com',
    /**
     * repo  → read private repos + events
     * read:user → basic profile
     */
    scopes: ['repo', 'read:user'],
  },
  oauth: {
    /** Local port for the temporary OAuth callback server */
    callbackPort: Number(process.env.OAUTH_CALLBACK_PORT || 42813),
  },
  monitor: {
    /**
     * STRATEGY: Polling (see services/pushMonitor.js and README).
     *
     * Custom function that returns the delay (ms) until the next poll cycle.
     * Called after every poll so you can adapt the interval (backoff, time of day,
     * rate-limit hints, etc.). Default: POLL_INTERVAL_MS or 60s.
     *
     * @returns {number}
     */
    getPollIntervalMs() {
      return Number(process.env.POLL_INTERVAL_MS || 60_000);
    },
    /** Events fetched per repo each poll cycle */
    eventsPerPage: 30,
  },
  notifications: {
    silent: false,
  },
};

function assertAuthConfig() {
  if (!config.github.clientId || !config.github.clientSecret) {
    const err = new Error(
      'Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET. Copy .env.example to .env and fill in your OAuth App credentials.'
    );
    err.code = 'CONFIG_MISSING';
    throw err;
  }
}

module.exports = { config, assertAuthConfig };
