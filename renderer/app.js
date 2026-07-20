/**
 * Renderer UI controller. Talks to main via window.gitPushNotifier (preload).
 */
const api = window.gitPushNotifier;

const els = {
  loginView: document.getElementById('view-login'),
  dashView: document.getElementById('view-dashboard'),
  configWarning: document.getElementById('config-warning'),
  btnLogin: document.getElementById('btn-login'),
  formPat: document.getElementById('form-pat'),
  inputPat: document.getElementById('input-pat'),
  btnPat: document.getElementById('btn-pat'),
  loginError: document.getElementById('login-error'),
  userAvatar: document.getElementById('user-avatar'),
  userLogin: document.getElementById('user-login'),
  btnLogout: document.getElementById('btn-logout'),
  monitorBadge: document.getElementById('monitor-badge'),
  formAddRepo: document.getElementById('form-add-repo'),
  inputRepo: document.getElementById('input-repo'),
  repoError: document.getElementById('repo-error'),
  repoList: document.getElementById('repo-list'),
  repoEmpty: document.getElementById('repo-empty'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnPoll: document.getElementById('btn-poll'),
  btnTestNotify: document.getElementById('btn-test-notify'),
  metaRunning: document.getElementById('meta-running'),
  metaLastPoll: document.getElementById('meta-last-poll'),
  selectPollInterval: document.getElementById('select-poll-interval'),
  inputPollInterval: document.getElementById('input-poll-interval'),
  intervalControls: document.getElementById('interval-controls'),
  pollIntervalCustomOption: null,
  metaError: document.getElementById('meta-error'),
  lastEvent: document.getElementById('last-event'),
  chkOpenAtLogin: document.getElementById('chk-open-at-login'),
  btnNavSettings: document.getElementById('btn-nav-settings'),
  settingsMenu: document.getElementById('settings-menu'),
  btnNavSound: document.getElementById('btn-nav-sound'),
  soundMenu: document.getElementById('sound-menu'),
  soundMenuLabel: document.getElementById('sound-menu-label'),
  btnChooseSound: document.getElementById('btn-choose-sound'),
  btnPreviewSound: document.getElementById('btn-preview-sound'),
  btnClearSound: document.getElementById('btn-clear-sound'),
  logList: document.getElementById('log-list'),
  appVersion: document.getElementById('app-version'),
  updateBanner: document.getElementById('update-banner'),
  updateBannerTitle: document.getElementById('update-banner-title'),
  updateBannerDetail: document.getElementById('update-banner-detail'),
  btnNavUpdate: document.getElementById('btn-nav-update'),
  btnInstallUpdate: document.getElementById('btn-install-update'),
};

function showError(el, message) {
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function renderRepos(state) {
  const repos = state.monitoredRepos || [];
  els.repoList.innerHTML = '';
  els.repoEmpty.classList.toggle('hidden', repos.length > 0);

  for (const repo of repos) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = repo.fullName || `${repo.owner}/${repo.name}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = repo.private ? 'Privado' : 'Público';
    info.append(name, meta);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn danger-text sm';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Quitar';
    removeBtn.addEventListener('click', async () => {
      await api.removeRepo(repo.owner, repo.name);
    });

    li.append(info, removeBtn);
    els.repoList.appendChild(li);
  }
}

function renderLastEvent(state) {
  const event = state.monitor?.lastEvent;
  if (!event) {
    // Fallback: most recent stored push across repos
    const pushState = state.pushState || {};
    const candidates = Object.values(pushState)
      .map((s) => s?.lastPush)
      .filter(Boolean)
      .sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
    const last = candidates[0];
    if (!last) {
      els.lastEvent.classList.add('muted');
      els.lastEvent.textContent = 'Sin eventos todavía.';
      return;
    }
    paintEvent(last);
    return;
  }
  paintEvent(event);
}

function paintEvent(event) {
  els.lastEvent.classList.remove('muted');
  els.lastEvent.textContent = [
    `Repo: ${event.repo}`,
    `Branch: ${event.branch}`,
    `Autor: ${event.author}`,
    `Commit: ${event.message}`,
    event.detectedAt ? `Detectado: ${formatTime(event.detectedAt)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const POLL_PRESET_MS = new Set([15000, 30000, 60000, 120000, 300000, 600000]);
let pollIntervalSyncing = false;
let lastPollIntervalMs = 60000;

function getCustomOption() {
  if (!els.pollIntervalCustomOption && els.selectPollInterval) {
    els.pollIntervalCustomOption = els.selectPollInterval.querySelector('option[value="custom"]');
  }
  return els.pollIntervalCustomOption;
}

function setIntervalEditing(editing) {
  els.intervalControls?.classList.toggle('is-editing', Boolean(editing));
  if (editing) {
    requestAnimationFrame(() => {
      els.inputPollInterval?.focus();
      els.inputPollInterval?.select();
    });
  }
}

function syncPollIntervalControls(ms) {
  const select = els.selectPollInterval;
  const input = els.inputPollInterval;
  if (!select || !input) return;

  const valueMs = Number(ms) || 60000;
  const seconds = Math.round(valueMs / 1000);
  const isPreset = POLL_PRESET_MS.has(valueMs);
  lastPollIntervalMs = valueMs;

  pollIntervalSyncing = true;
  input.value = String(seconds);
  select.value = isPreset ? String(valueMs) : 'custom';

  const customOpt = getCustomOption();
  if (customOpt) {
    customOpt.textContent = isPreset ? 'Personalizado' : `${seconds} s`;
  }

  // Keep select visible unless the user is actively typing a custom value
  if (!els.intervalControls?.classList.contains('is-editing')) {
    setIntervalEditing(false);
  }
  pollIntervalSyncing = false;
}

async function applyPollIntervalMs(ms) {
  const result = await api.setPollInterval(ms);
  if (!result?.ok) {
    showError(els.repoError, result?.error || 'No se pudo actualizar el intervalo');
    return false;
  }
  showError(els.repoError, null);
  setIntervalEditing(false);
  return true;
}

function renderMonitor(state) {
  const running = Boolean(state.monitor?.running);
  els.monitorBadge.textContent = running ? 'Monitoreando' : 'Detenido';
  els.monitorBadge.className = `badge ${running ? 'on' : 'off'}`;
  els.metaRunning.textContent = running ? 'Activo (polling)' : 'Detenido';
  els.metaLastPoll.textContent = formatTime(state.monitor?.lastPollAt);
  syncPollIntervalControls(state.pollIntervalMs);
  els.metaError.textContent = state.monitor?.lastError || 'Ninguno';
  els.metaError.style.color = state.monitor?.lastError ? 'var(--danger)' : '';

  if (els.chkOpenAtLogin) {
    els.chkOpenAtLogin.checked = state.settings?.openAtLogin !== false;
  }
}

function appendLog(entry) {
  const row = document.createElement('div');
  row.className = 'log-entry';
  const time = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '';
  const lvl = document.createElement('span');
  lvl.className = `lvl-${entry.level}`;
  lvl.textContent = entry.level?.toUpperCase?.() || 'INFO';
  row.append(
    document.createTextNode(`[${time}] `),
    lvl,
    document.createTextNode(` ${entry.message}`)
  );
  els.logList.appendChild(row);
  while (els.logList.children.length > 100) {
    els.logList.removeChild(els.logList.firstChild);
  }
  els.logList.scrollTop = els.logList.scrollHeight;
}

function renderSound(state) {
  const sound = state.sound || {};
  const source = sound.soundSource || (sound.hasCustomSound ? 'custom' : 'system');

  if (source === 'custom') {
    els.soundMenuLabel.textContent = `Personalizado: ${sound.customSoundName || sound.activeSoundName}`;
    els.soundMenuLabel.classList.remove('muted');
    els.btnNavSound.classList.add('active');
    els.btnPreviewSound.disabled = false;
    els.btnClearSound.disabled = false;
  } else if (source === 'default') {
    els.soundMenuLabel.textContent = `Por defecto (${sound.activeSoundName || 'levelup_sVAqjan.mp3'})`;
    els.soundMenuLabel.classList.add('muted');
    els.btnNavSound.classList.add('active');
    els.btnPreviewSound.disabled = false;
    els.btnClearSound.disabled = true;
  } else {
    els.soundMenuLabel.textContent = 'Sonido del sistema (sin MP3 por defecto)';
    els.soundMenuLabel.classList.add('muted');
    els.btnNavSound.classList.remove('active');
    els.btnPreviewSound.disabled = true;
    els.btnClearSound.disabled = true;
  }
}

function setSoundMenuOpen(open) {
  els.soundMenu.classList.toggle('hidden', !open);
  els.btnNavSound.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setSettingsMenuOpen(open) {
  els.settingsMenu?.classList.toggle('hidden', !open);
  els.btnNavSettings?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderUpdate(update, appVersion) {
  if (els.appVersion && appVersion) {
    els.appVersion.textContent = `v${appVersion}`;
  }

  const banner = els.updateBanner;
  if (!banner) return;

  const status = update?.status || 'idle';
  const available = update?.availableVersion;
  const percent = update?.percent;
  const showBanner =
    Boolean(update?.packaged) &&
    (status === 'available' || status === 'downloading' || status === 'downloaded');

  banner.classList.toggle('hidden', !showBanner);
  banner.classList.remove('is-downloading', 'is-error');
  els.btnInstallUpdate?.classList.add('hidden');

  if (els.btnNavUpdate) {
    els.btnNavUpdate.disabled = status === 'checking' || status === 'downloading';
  }

  if (!showBanner) return;

  switch (status) {
    case 'available':
      els.updateBannerTitle.textContent = `Nueva versión ${available}`;
      els.updateBannerDetail.textContent = 'Descargando en segundo plano…';
      banner.classList.add('is-downloading');
      break;
    case 'downloading':
      els.updateBannerTitle.textContent = `Descargando ${available || 'actualización'}…`;
      els.updateBannerDetail.textContent = percent != null ? `${percent}%` : '';
      banner.classList.add('is-downloading');
      break;
    case 'downloaded':
      els.updateBannerTitle.textContent = `Listo: v${available}`;
      els.updateBannerDetail.textContent = 'Reinicia para instalar la actualización.';
      els.btnInstallUpdate?.classList.remove('hidden');
      break;
    default:
      break;
  }
}

function renderState(state) {
  const authed = Boolean(state.authenticated);

  els.loginView.classList.toggle('hidden', authed);
  els.dashView.classList.toggle('hidden', !authed);

  els.configWarning.classList.toggle('hidden', state.configReady !== false);
  els.btnLogin.disabled = state.configReady === false;

  if (!authed) return;

  els.userLogin.textContent = state.user?.login
    ? `${state.user.login}${state.authMethod === 'pat' ? ' (PAT)' : ''}`
    : 'usuario';
  if (state.user?.avatarUrl) {
    els.userAvatar.src = state.user.avatarUrl;
    els.userAvatar.alt = state.user.login || '';
  }

  renderRepos(state);
  renderMonitor(state);
  renderLastEvent(state);
  renderSound(state);
  renderUpdate(state.update, state.appVersion);
}

async function bootstrap() {
  const state = await api.getState();
  renderState(state);

  const logs = await api.getLogs();
  els.logList.innerHTML = '';
  for (const entry of logs) appendLog(entry);

  api.onState(renderState);
  api.onLog(appendLog);
  api.onUpdate((update) => renderUpdate(update, update.currentVersion));

  els.btnNavUpdate?.addEventListener('click', async () => {
    showError(els.repoError, null);
    els.btnNavUpdate.disabled = true;
    els.btnNavUpdate.textContent = 'Buscando…';
    try {
      const result = await api.checkForUpdates();
      if (result?.skipped) {
        showError(
          els.repoError,
          'Las actualizaciones solo funcionan con el instalador (npm run dist / release), no con npm start.'
        );
        return;
      }
      if (result?.ok === false && result.error) {
        showError(els.repoError, result.error);
        return;
      }
      // If still up to date, give brief feedback without showing the green banner
      const update = await api.getUpdateState();
      if (update?.status === 'not-available' || update?.status === 'idle') {
        showError(els.repoError, null);
        els.btnNavUpdate.textContent = 'Al día';
        setTimeout(() => {
          if (els.btnNavUpdate) els.btnNavUpdate.textContent = 'Buscar updates';
        }, 2000);
        return;
      }
    } finally {
      if (els.btnNavUpdate) {
        els.btnNavUpdate.disabled = false;
        if (els.btnNavUpdate.textContent === 'Buscando…') {
          els.btnNavUpdate.textContent = 'Buscar updates';
        }
      }
    }
  });

  els.btnInstallUpdate?.addEventListener('click', async () => {
    const result = await api.installUpdate();
    if (result?.ok === false && result.error) {
      showError(els.repoError, result.error);
    }
  });

  const linkCreatePat = document.getElementById('link-create-pat');
  if (linkCreatePat) {
    linkCreatePat.addEventListener('click', (e) => {
      e.preventDefault();
      api.openExternal(linkCreatePat.href);
    });
  }

  els.btnLogin.addEventListener('click', async () => {
    showError(els.loginError, null);
    els.btnLogin.disabled = true;
    els.btnLogin.textContent = 'Esperando autorización…';
    try {
      const result = await api.login();
      if (!result.ok) {
        showError(els.loginError, result.error || 'Error de autenticación');
      }
    } finally {
      els.btnLogin.disabled = false;
      els.btnLogin.textContent = 'Iniciar sesión con GitHub (OAuth)';
    }
  });

  els.formPat.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(els.loginError, null);
    const token = els.inputPat.value.trim();
    if (!token) {
      showError(els.loginError, 'Pega tu Personal Access Token.');
      return;
    }
    els.btnPat.disabled = true;
    els.btnPat.textContent = 'Validando token…';
    try {
      const result = await api.loginWithPat(token);
      if (!result.ok) {
        showError(els.loginError, result.error || 'No se pudo entrar con el PAT');
        return;
      }
      els.inputPat.value = '';
    } finally {
      els.btnPat.disabled = false;
      els.btnPat.textContent = 'Entrar con PAT';
    }
  });

  els.btnLogout.addEventListener('click', () => api.logout());

  els.formAddRepo.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(els.repoError, null);
    const value = els.inputRepo.value.trim();
    if (!value) return;
    const result = await api.addRepo(value);
    if (!result.ok) {
      showError(els.repoError, result.error);
      return;
    }
    els.inputRepo.value = '';
  });

  els.btnStart.addEventListener('click', () => api.startMonitor());
  els.btnStop.addEventListener('click', () => api.stopMonitor());
  els.btnPoll.addEventListener('click', () => api.pollNow());
  els.btnTestNotify.addEventListener('click', () => api.testNotification());

  els.chkOpenAtLogin?.addEventListener('change', async () => {
    const enabled = els.chkOpenAtLogin.checked;
    const result = await api.setOpenAtLogin(enabled);
    if (!result?.ok) {
      els.chkOpenAtLogin.checked = !enabled;
      showError(els.repoError, result?.error || 'No se pudo actualizar el arranque con Windows');
    }
  });

  els.selectPollInterval.addEventListener('change', async () => {
    if (pollIntervalSyncing) return;
    const raw = els.selectPollInterval.value;
    if (raw === 'custom') {
      els.inputPollInterval.value = String(Math.round(lastPollIntervalMs / 1000));
      setIntervalEditing(true);
      return;
    }
    await applyPollIntervalMs(Number(raw));
  });

  const cancelCustomInterval = () => {
    pollIntervalSyncing = true;
    els.inputPollInterval.value = String(Math.round(lastPollIntervalMs / 1000));
    els.selectPollInterval.value = POLL_PRESET_MS.has(lastPollIntervalMs)
      ? String(lastPollIntervalMs)
      : 'custom';
    pollIntervalSyncing = false;
    setIntervalEditing(false);
    showError(els.repoError, null);
  };

  const commitCustomInterval = async () => {
    if (pollIntervalSyncing) return;
    const seconds = Number(els.inputPollInterval.value);
    if (!Number.isFinite(seconds)) {
      showError(els.repoError, 'Escribe un número de segundos válido.');
      return;
    }
    const ok = await applyPollIntervalMs(Math.round(seconds) * 1000);
    if (!ok) {
      // Stay in editing mode so the user can fix the value
      setIntervalEditing(true);
    }
  };

  els.inputPollInterval.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCustomInterval();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCustomInterval();
    }
  });

  els.inputPollInterval.addEventListener('blur', () => {
    if (!els.intervalControls?.classList.contains('is-editing')) return;
    // Defer so a click on another control can cancel first if needed
    setTimeout(() => {
      if (document.activeElement === els.inputPollInterval) return;
      if (!els.intervalControls?.classList.contains('is-editing')) return;
      commitCustomInterval();
    }, 0);
  });

  els.btnChooseSound.addEventListener('click', async () => {
    const result = await api.chooseSound();
    if (result?.ok === false && result.error) {
      showError(els.repoError, result.error);
    }
    setSoundMenuOpen(false);
  });

  els.btnPreviewSound.addEventListener('click', async () => {
    const result = await api.previewSound();
    if (!result?.ok && result?.error) {
      showError(els.repoError, result.error);
    }
  });

  els.btnClearSound.addEventListener('click', async () => {
    await api.clearSound();
    setSoundMenuOpen(false);
  });

  els.btnNavSettings?.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = els.settingsMenu?.classList.contains('hidden');
    setSoundMenuOpen(false);
    setSettingsMenuOpen(Boolean(opening));
  });

  els.btnNavSound.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = els.soundMenu.classList.contains('hidden');
    setSettingsMenuOpen(false);
    setSoundMenuOpen(opening);
  });

  document.addEventListener('click', (e) => {
    if (!els.soundMenu.classList.contains('hidden')) {
      const soundRoot = els.btnNavSound.closest('.nav-sound');
      if (soundRoot && !soundRoot.contains(e.target)) {
        setSoundMenuOpen(false);
      }
    }
    if (els.settingsMenu && !els.settingsMenu.classList.contains('hidden')) {
      const settingsRoot = els.btnNavSettings?.closest('.nav-settings');
      if (settingsRoot && !settingsRoot.contains(e.target)) {
        setSettingsMenuOpen(false);
      }
    }
  });
}

bootstrap().catch((err) => {
  console.error(err);
  showError(els.loginError, err.message || String(err));
  els.loginView.classList.remove('hidden');
});
