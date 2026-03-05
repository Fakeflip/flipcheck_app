/* Flipcheck Extension — Options Page Script */

const CATS = [
  { id: 'computer_tablets', label: 'Computer / Tablets' },
  { id: 'handys',           label: 'Smartphones' },
  { id: 'konsolen',         label: 'Gaming / Konsolen' },
  { id: 'foto_camcorder',   label: 'Foto & Camcorder' },
  { id: 'tv_video_audio',   label: 'TV, Video & Audio' },
  { id: 'haushaltsgeraete', label: 'Haushaltsgeräte' },
  { id: 'drucker',          label: 'Drucker / Scanner' },
  { id: 'handy_zubehoer',   label: 'Handy-Zubehör' },
  { id: 'notebook_zubehoer',label: 'Notebook-Zubehör' },
  { id: 'kabel',            label: 'Kabel & Stecker' },
  { id: 'mode',             label: 'Mode / Bekleidung' },
  { id: 'sport_freizeit',   label: 'Sport & Freizeit' },
  { id: 'spielzeug',        label: 'Spielzeug / LEGO' },
  { id: 'buecher',          label: 'Bücher & Medien' },
  { id: 'sonstiges',        label: 'Sonstiges' },
];

const $ = id => document.getElementById(id);

// ── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  buildCatOptions();
  setExtVersion();

  // Handle token from URL redirect (e.g., OAuth callback with ?token=...)
  handleUrlToken();

  await Promise.all([
    loadAndRenderToken(),
    loadAndRenderSettings(),
    checkBridge(),
    loadProfile(),
  ]);

  wireEvents();

  // ── Login Button ──────────────────────────────────────────────────────────────
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'LOGIN' }, res => {
        if (res?.ok) {
          loginBtn.textContent = '✓ Tab geöffnet — nach Login hier neu laden';
          loginBtn.disabled = true;
          setTimeout(() => {
            loginBtn.textContent = '🔗 Mit Discord anmelden';
            loginBtn.disabled = false;
          }, 5000);
        }
      });
    });
  }
})();

// ── URL Token Handling ────────────────────────────────────────────────────────
function handleUrlToken() {
  const urlToken = new URLSearchParams(location.search).get('token');
  if (urlToken) {
    chrome.runtime.sendMessage(
      { type: 'AUTH_SET_TOKEN', token: urlToken },
      res => {
        if (res?.ok) {
          history.replaceState({}, '', location.pathname);
          showToast('Erfolgreich angemeldet!', 'success');
          loadAndRenderToken();
          loadProfile();
        }
      },
    );
  }
}

// ── Extension Version ─────────────────────────────────────────────────────────
function setExtVersion() {
  const manifest = chrome.runtime.getManifest();
  $('extVersion').textContent = `v${manifest.version}`;
}

// ── Build Category <select> ────────────────────────────────────────────────
function buildCatOptions() {
  $('settingCat').innerHTML = CATS.map(c =>
    `<option value="${c.id}">${c.label}</option>`,
  ).join('');
}

// ── Token ─────────────────────────────────────────────────────────────────────
async function loadAndRenderToken() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'AUTH_GET_TOKEN' }, res => {
      const hasToken = !!(res?.token);
      const dot  = $('tokenDot');
      const text = $('tokenStatusText');
      if (hasToken) {
        dot.className  = 'opt-token-dot active';
        text.textContent = 'Aktiv';
        text.style.color = 'var(--green)';
      } else {
        dot.className  = 'opt-token-dot inactive';
        text.textContent = 'Kein Token';
        text.style.color = 'var(--red)';
      }
      resolve();
    });
  });
}

// ── Profile ────────────────────────────────────────────────────────────────
async function loadProfile() {
  // Get the stored token first
  chrome.runtime.sendMessage({ type: 'AUTH_GET_TOKEN' }, async res => {
    const token = res?.token;
    if (!token) {
      $('profileName').textContent = 'Nicht angemeldet';
      $('profileEmail').textContent = '';
      $('profileAvatar').textContent = '?';
      return;
    }

    try {
      const r = await fetch('https://api.joinflipcheck.app/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error('not_ok');
      const u = await r.json();

      const name     = u.username || u.discord_username || 'Nutzer';
      const email    = u.email || '';
      const plan     = (u.plan || 'FREE').toUpperCase();
      const avatarUrl = u.avatar_url || '';
      const initials  = name.slice(0, 2).toUpperCase();

      $('profileName').textContent = name;
      $('profileEmail').textContent = email;

      const avatarEl = $('profileAvatar');
      if (avatarUrl) {
        avatarEl.innerHTML = `<img src="${avatarUrl}" alt="Avatar" />`;
      } else {
        avatarEl.textContent = initials;
      }

      const planColors = {
        FREE:     '#475569',
        PRO:      '#6366F1',
        LIFETIME: '#F59E0B',
        TEAM:     '#3B82F6',
      };
      const pc = planColors[plan] || '#475569';
      const planBadge = $('profilePlan');
      planBadge.textContent = plan;
      planBadge.style.cssText = `background:${pc}22;color:${pc};border:1px solid ${pc}44`;
      planBadge.style.display = '';

    } catch {
      $('profileName').textContent = 'Angemeldet';
      $('profileEmail').textContent = '(Profil konnte nicht geladen werden)';
    }
  });
}

// ── Bridge Status ─────────────────────────────────────────────────────────────
async function checkBridge() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' }, res => {
      const dot  = $('bridgeDot');
      const info = $('bridgeInfo');
      if (res?.ok) {
        dot.classList.add('connected');
        const v = res.data?.version ? ` (v${res.data.version})` : '';
        info.textContent = `Verbunden${v}`;
        info.style.color = 'var(--green)';
      } else {
        dot.classList.remove('connected');
        info.textContent = 'Nicht erreichbar — Desktop starten';
        info.style.color = 'var(--text-dim)';
      }
      resolve();
    });
  });
}

// ── Load + Render Settings ─────────────────────────────────────────────────
async function loadAndRenderSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
      const s = res?.data || {};
      if (s.defaultCat)       $('settingCat').value        = s.defaultCat;
      if (s.defaultMode)      $('settingMode').value       = s.defaultMode;
      if (s.vatMode)          $('settingVat').value        = s.vatMode;
      if (s.ekMode)           $('settingEkMode').value     = s.ekMode;
      if (s.backendUrl)       $('backendUrl').value        = s.backendUrl;
      if (s.serpBadges === false)        $('settingSerpBadges').checked       = false;
      if (s.amazonSerpBadges === false)  $('settingAmazonSerpBadges').checked = false;
      if (s.autoPanel  === false)        $('settingAutoPanel').checked        = false;
      if (s.keepaKey)      { const el = document.getElementById('keepaKey');      if (el) el.value = s.keepaKey; }
      if (s.defaultShipIn  != null) { const el = document.getElementById('defaultShipIn');  if (el) el.value = s.defaultShipIn; }
      if (s.defaultShipOut != null) { const el = document.getElementById('defaultShipOut'); if (el) el.value = s.defaultShipOut; }
      resolve();
    });
  });
}

// ── Wire Events ───────────────────────────────────────────────────────────────
function wireEvents() {
  // Save token
  $('saveTokenBtn').addEventListener('click', () => {
    const token = $('tokenInp').value.trim();
    if (!token) { showToast('Bitte Token eingeben.', 'error'); return; }
    chrome.runtime.sendMessage({ type: 'AUTH_SET_TOKEN', token }, res => {
      if (res?.ok) {
        showToast('Token gespeichert ✓', 'success');
        $('tokenInp').value = '';
        loadAndRenderToken();
        loadProfile();
      } else {
        showToast('Fehler beim Speichern.', 'error');
      }
    });
  });

  // Save settings
  $('saveSettingsBtn').addEventListener('click', () => {
    const settings = {
      defaultCat:  $('settingCat').value,
      defaultMode: $('settingMode').value,
      vatMode:     $('settingVat').value,
      ekMode:      $('settingEkMode').value,
      backendUrl:  $('backendUrl').value.trim() || null,
      serpBadges:        $('settingSerpBadges').checked,
      amazonSerpBadges:  $('settingAmazonSerpBadges').checked,
      autoPanel:         $('settingAutoPanel').checked,
      keepaKey:       (document.getElementById('keepaKey')?.value      || '').trim(),
      defaultShipIn:  parseFloat(document.getElementById('defaultShipIn')?.value)  || 0,
      defaultShipOut: parseFloat(document.getElementById('defaultShipOut')?.value) || 3.49,
    };
    chrome.runtime.sendMessage({ type: 'SETTINGS_SET', settings }, res => {
      if (res?.ok) {
        showToast('Einstellungen gespeichert ✓', 'success');
      } else {
        showToast('Fehler beim Speichern.', 'error');
      }
    });
  });

  // Logout
  $('logoutBtn').addEventListener('click', () => {
    if (!confirm('Wirklich abmelden? Der Token wird gelöscht.')) return;
    chrome.runtime.sendMessage({ type: 'AUTH_CLEAR' }, res => {
      if (res?.ok) {
        showToast('Abgemeldet.', 'success');
        loadAndRenderToken();
        $('profileName').textContent = 'Nicht angemeldet';
        $('profileEmail').textContent = '';
        $('profileAvatar').textContent = '?';
        $('profilePlan').style.display = 'none';
      }
    });
  });

  // Re-check bridge on focus
  window.addEventListener('focus', checkBridge);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = `opt-toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}
