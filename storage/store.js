/**
 * Local persistence via electron-store.
 * Remembers session, monitored repos, and last processed push per repo.
 */
const Store = require('electron-store');

const store = new Store({
  name: 'git-push-notifier',
  defaults: {
    session: null,
    monitoredRepos: [],
    /**
     * Map of "owner/repo" → { lastEventId, lastPush, etag }
     * Used by the poller to skip duplicates and avoid re-notifying on startup.
     */
    pushState: {},
    settings: {
      minimizeToTray: true,
      startMonitoringOnLaunch: true,
      /** Launch automatically when the user signs in to Windows */
      openAtLogin: true,
      /** Poll delay in ms; null → use config.monitor.getPollIntervalMs() */
      pollIntervalMs: null,
      customSoundPath: null,
      customSoundName: null,
    },
  },
});

const storage = {
  getSession() {
    return store.get('session');
  },

  setSession(session) {
    store.set('session', session);
  },

  clearSession() {
    store.set('session', null);
  },

  getMonitoredRepos() {
    return store.get('monitoredRepos') || [];
  },

  setMonitoredRepos(repos) {
    store.set('monitoredRepos', repos);
  },

  addMonitoredRepo(repo) {
    const list = this.getMonitoredRepos();
    const key = `${repo.owner}/${repo.name}`.toLowerCase();
    if (list.some((r) => `${r.owner}/${r.name}`.toLowerCase() === key)) {
      return { added: false, repos: list };
    }
    const next = [...list, repo];
    this.setMonitoredRepos(next);
    return { added: true, repos: next };
  },

  removeMonitoredRepo(owner, name) {
    const key = `${owner}/${name}`.toLowerCase();
    const next = this.getMonitoredRepos().filter(
      (r) => `${r.owner}/${r.name}`.toLowerCase() !== key
    );
    this.setMonitoredRepos(next);

    const pushState = store.get('pushState') || {};
    delete pushState[key];
    store.set('pushState', pushState);

    return next;
  },

  getPushState(repoKey) {
    const all = store.get('pushState') || {};
    return all[repoKey.toLowerCase()] || null;
  },

  setPushState(repoKey, state) {
    const all = store.get('pushState') || {};
    all[repoKey.toLowerCase()] = state;
    store.set('pushState', all);
  },

  getSettings() {
    return store.get('settings');
  },

  setSettings(partial) {
    store.set('settings', { ...this.getSettings(), ...partial });
  },

  getAllForUi() {
    return {
      session: this.getSession(),
      monitoredRepos: this.getMonitoredRepos(),
      pushState: store.get('pushState') || {},
      settings: this.getSettings(),
    };
  },
};

module.exports = storage;
