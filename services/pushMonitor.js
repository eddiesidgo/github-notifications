/**
 * Push detection strategy: POLLING against the GitHub Repository Events API.
 *
 * Why polling (not webhooks)?
 * ---------------------------
 * GitHub webhooks require a publicly reachable HTTPS endpoint to deliver POST
 * payloads. A pure Electron desktop app on Windows does not expose such an
 * endpoint without extra infrastructure (ngrok, Cloudflare Tunnel, or a cloud
 * relay). Polling keeps the app fully local and installable for any teammate.
 *
 * How it works
 * ------------
 * 1. After each cycle, `config.monitor.getPollIntervalMs()` decides the delay
 *    until the next poll (default 60s). For each monitored repo we call
 *    GET /repos/{owner}/{repo}/events with If-None-Match (ETag) to avoid
 *    re-downloading unchanged data.
 * 2. We filter type === "PushEvent".
 * 3. We keep `lastEventId` per repository in electron-store so the same push
 *    is never notified twice, including across app restarts.
 * 4. The first successful poll after adding a repo only establishes a baseline
 *    (no flood of historical notifications).
 *
 * Limitations
 * -----------
 * - GitHub's events timeline only retains a limited recent window (~300 events).
 * - Latency is bound to the poll interval (default ~60 seconds).
 * - Private repos require a token with the `repo` scope.
 */
const { config } = require('../config');
const storage = require('../storage/store');
const { githubApi, GitHubApiError } = require('./githubApi');
const { notifyPush } = require('../notifications/notifier');
const logger = require('./logger');

class PushMonitor {
  constructor() {
    this._timer = null;
    this._running = false;
    this._polling = false;
    this._status = {
      running: false,
      lastPollAt: null,
      lastError: null,
      lastEvent: null,
    };
    this._listeners = new Set();
  }

  onStatus(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getStatus() {
    return { ...this._status };
  }

  _emit() {
    const snapshot = this.getStatus();
    for (const listener of this._listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore
      }
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._status.running = true;
    this._status.lastError = null;
    const intervalMs = this._resolvePollIntervalMs();
    logger.info('Push monitor started', { intervalMs });
    this._emit();
    this.pollOnce()
      .catch(() => {})
      .finally(() => this._scheduleNextPoll());
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = null;
    this._running = false;
    this._status.running = false;
    logger.info('Push monitor stopped');
    this._emit();
  }

  /**
   * Re-apply the current poll interval (e.g. after the user changes it in the UI).
   * Safe to call while running; no-op if stopped.
   */
  reschedule() {
    if (!this._running) return;
    this._scheduleNextPoll();
  }

  /** @returns {number} */
  _resolvePollIntervalMs() {
    const fromSettings = Number(storage.getSettings()?.pollIntervalMs);
    if (Number.isFinite(fromSettings) && fromSettings > 0) {
      return fromSettings;
    }
    const fn = config.monitor.getPollIntervalMs;
    const value = typeof fn === 'function' ? fn.call(config.monitor) : Number(fn);
    return Number.isFinite(value) && value > 0 ? value : 60_000;
  }

  _scheduleNextPoll() {
    if (!this._running) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const intervalMs = this._resolvePollIntervalMs();
    this._timer = setTimeout(() => {
      this._timer = null;
      this.pollOnce()
        .catch(() => {})
        .finally(() => this._scheduleNextPoll());
    }, intervalMs);
    // Prevent the timer from keeping Node awake oddly in some Electron builds
    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  async pollOnce() {
    if (this._polling) return;
    this._polling = true;

    try {
      const repos = storage.getMonitoredRepos();
      if (!repos.length) {
        this._status.lastPollAt = new Date().toISOString();
        this._status.lastError = null;
        this._emit();
        return;
      }

      for (const repo of repos) {
        await this._pollRepo(repo);
      }

      this._status.lastPollAt = new Date().toISOString();
      this._status.lastError = null;
      this._emit();
    } catch (err) {
      const message = err.message || String(err);
      this._status.lastError = message;
      logger.error('Poll cycle failed', {
        code: err.code,
        message,
      });
      this._emit();

      if (err instanceof GitHubApiError && err.code === 'TOKEN_INVALID') {
        this.stop();
      }
    } finally {
      this._polling = false;
    }
  }

  async _pollRepo(repo) {
    const repoKey = `${repo.owner}/${repo.name}`;
    const prev = storage.getPushState(repoKey) || {};

    let result;
    try {
      result = await githubApi.getRepositoryEvents(repo.owner, repo.name, {
        etag: prev.etag,
        perPage: config.monitor.eventsPerPage,
      });
    } catch (err) {
      if (err instanceof GitHubApiError && (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN')) {
        logger.warn(`No access to ${repoKey}`, { code: err.code });
        this._status.lastError = `${repoKey}: ${err.message}`;
        this._emit();
        return;
      }
      throw err;
    }

    if (result.status === 304) {
      logger.debug(`No changes for ${repoKey} (304)`);
      return;
    }

    const events = Array.isArray(result.data) ? result.data : [];
    const pushEvents = events.filter((e) => e.type === 'PushEvent');

    // Newest first from GitHub — process oldest-first among new ones
    const newestId = pushEvents[0]?.id || prev.lastEventId || null;

    if (!prev.lastEventId) {
      // Baseline: remember the newest event without notifying
      storage.setPushState(repoKey, {
        lastEventId: newestId,
        etag: result.etag || prev.etag || null,
        lastPush: prev.lastPush || null,
        baselineAt: new Date().toISOString(),
      });
      logger.info(`Baseline set for ${repoKey}`, { lastEventId: newestId });
      return;
    }

    const lastIdNum = BigInt(prev.lastEventId);
    const fresh = pushEvents
      .filter((e) => {
        try {
          return BigInt(e.id) > lastIdNum;
        } catch {
          return e.id !== prev.lastEventId;
        }
      })
      .reverse(); // chronological

    for (const event of fresh) {
      const payload = await this._mapPushEvent(repo, event);
      if (!payload) continue;

      await notifyPush(payload);
      this._status.lastEvent = {
        ...payload,
        detectedAt: new Date().toISOString(),
        eventId: event.id,
      };
      storage.setPushState(repoKey, {
        lastEventId: event.id,
        etag: result.etag || null,
        lastPush: this._status.lastEvent,
      });
      logger.info('New push detected', payload);
      this._emit();
    }

    // Always refresh etag / high-water mark even if no new pushes
    if (!fresh.length) {
      storage.setPushState(repoKey, {
        ...prev,
        lastEventId: newestId && BigInt(newestId) > lastIdNum ? newestId : prev.lastEventId,
        etag: result.etag || prev.etag || null,
      });
    } else {
      // Ensure etag is stored after loop (last write may already have it)
      const current = storage.getPushState(repoKey) || {};
      storage.setPushState(repoKey, {
        ...current,
        etag: result.etag || current.etag || null,
      });
    }
  }

  /**
   * Build a notification payload from a PushEvent.
   * GitHub may omit or truncate `payload.commits` (max 20), so we fall back to
   * GET /repos/{owner}/{repo}/commits/{sha} whenever the message is missing.
   */
  async _mapPushEvent(repo, event) {
    try {
      const branchRef = event.payload?.ref || '';
      const branch = branchRef.replace(/^refs\/heads\//, '') || 'unknown';
      const commits = Array.isArray(event.payload?.commits) ? event.payload.commits : [];
      const headSha = event.payload?.head || null;

      const headCommit =
        commits.find(
          (c) =>
            c.sha === headSha ||
            (headSha && c.sha && (headSha.startsWith(c.sha) || c.sha.startsWith(headSha)))
        ) ||
        commits.filter((c) => c.distinct !== false).at(-1) ||
        commits.at(-1) ||
        null;

      let sha = headSha || headCommit?.sha || null;
      let message = String(headCommit?.message || '').trim();
      let author =
        event.actor?.login ||
        headCommit?.author?.username ||
        headCommit?.author?.name ||
        event.payload?.pusher?.name ||
        null;
      let url =
        headCommit?.url
          ?.replace('https://api.github.com/repos/', 'https://github.com/')
          .replace('/commits/', '/commit/') || null;

      // Enrich from Commits API when the event payload has no usable message
      if (sha && !message) {
        try {
          const commit = await githubApi.getCommit(repo.owner, repo.name, sha);
          message = String(commit.message || '').trim();
          sha = commit.sha || sha;
          url = commit.htmlUrl || url;
          author = author || commit.authorLogin || commit.authorName;
          logger.debug('Commit message enriched from Commits API', {
            repo: `${repo.owner}/${repo.name}`,
            sha: sha.slice(0, 7),
          });
        } catch (err) {
          logger.warn('Could not fetch commit details', {
            sha,
            message: err.message,
          });
        }
      }

      if (!url && sha) {
        url = `https://github.com/${repo.owner}/${repo.name}/commit/${sha}`;
      }
      if (!url) {
        url = `https://github.com/${repo.owner}/${repo.name}/tree/${encodeURIComponent(branch)}`;
      }

      const shortMessage = (message || '(sin mensaje)').split('\n')[0].slice(0, 120);

      return {
        repo: `${repo.owner}/${repo.name}`,
        branch,
        author: author || 'unknown',
        message: shortMessage,
        url,
        sha,
      };
    } catch (err) {
      logger.warn('Failed to map PushEvent', { error: err.message });
      return null;
    }
  }
}

module.exports = new PushMonitor();
