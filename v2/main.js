const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { spawn, execSync } = require("child_process");
const keytar = require("keytar");
const os = require("os");
const crypto = require("crypto");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { loadSettings, saveSettings } = require("./settingsStore.js");
const {
  SCHEMA_VERSION, VALID_MARKETS, VALID_STATUSES,
  uid, nowIso, normalizeItem, migrateInv, validateItems,
} = require("./inventory-logic.js");

// ─── Auto-Updater (electron-updater) ─────────────────────────────────────────
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
  const log   = require("electron-log");
  autoUpdater.logger          = log;
  autoUpdater.autoDownload    = true;
  autoUpdater.autoInstallOnAppQuit = true;
} catch {}

// ─── Paths ───────────────────────────────────────────────────────────────────
const APP_HTML = path.join(__dirname, "index.html");
const IS_PROD = app.isPackaged;

// ─── Env ──────────────────────────────────────────────────────────────────────
try {
  const prodEnv = path.join(process.resourcesPath, ".env");
  require("dotenv").config({ path: fs.existsSync(prodEnv) ? prodEnv : undefined });
} catch {}

const MODE = IS_PROD ? "remote" : (process.env.FLIPCHECK_MODE || "local").toLowerCase();
const REMOTE_BASE = (process.env.FLIPCHECK_BACKEND_BASE || "https://api.joinflipcheck.app").replace(/\/+$/, "");
const AUTH_URL = process.env.FLIPCHECK_AUTH_URL || "https://gate.joinflipcheck.app/auth/discord/login";
const APP_VERSION = process.env.FLIPCHECK_VERSION || app.getVersion() || "2.0.0";
const HOST = "127.0.0.1";
const PORT_FROM = 9000;
const PORT_TO = 9099;

let mainWindow = null;
let backendProc = null;
let BACKEND_PORT = null;
let _backendRestarting = false; // prevents restart loops on intentional shutdown

// ─── Keytar ──────────────────────────────────────────────────────────────────
const SVC = "flipcheck";
const ACC = "gate_token";
const getToken = () => keytar.getPassword(SVC, ACC).catch(() => null);
const saveToken = (t) => keytar.setPassword(SVC, ACC, t).catch(() => {});
const deleteToken = () => keytar.deletePassword(SVC, ACC).catch(() => {});

// ─── Inventory Store ─────────────────────────────────────────────────────────
// SCHEMA_VERSION, VALID_MARKETS, VALID_STATUSES, uid, nowIso, normalizeItem,
// migrateInv, validateItems → all imported from inventory-logic.js above.

let _invCache = null;   // { version, items[] } — populated on first readInv()

function invPath()    { return path.join(app.getPath("userData"), "inventory.json"); }
function invTmpPath() { return invPath() + ".tmp"; }
function invBakPath() { return invPath() + ".bak"; }

/**
 * Atomic write: JSON → temp file → fs.renameSync → live file.
 * Prevents inventory.json corruption on crash mid-write.
 * Also keeps _invCache in sync so callers never see stale data.
 */
function writeInv(state) {
  try {
    const tmp = invTmpPath();
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, invPath());
    _invCache = state;
    return true;
  } catch (e) {
    console.error("[Inv] writeInv failed:", e.message);
    return false;
  }
}

/**
 * Copy the current inventory file to inventory.json.bak before
 * destructive operations (clear, potential future bulk-delete).
 */
function backupInv() {
  try {
    const src = invPath();
    if (fs.existsSync(src)) fs.copyFileSync(src, invBakPath());
  } catch {}
}

// migrateInv() and validateItems() imported from inventory-logic.js

/**
 * Read inventory — returns in-memory cache on all calls after the first.
 * First call reads disk, applies migrations + validation, persists if upgraded.
 */
function readInv() {
  if (_invCache) return _invCache;
  try {
    const p = invPath();
    if (!fs.existsSync(p)) {
      _invCache = { version: SCHEMA_VERSION, items: [] };
      return _invCache;
    }
    let store = JSON.parse(fs.readFileSync(p, "utf8") || "{}");
    if (!Array.isArray(store?.items)) store.items = [];
    const needsMigration = (store.version || 1) < SCHEMA_VERSION;
    store = migrateInv(store);
    store.items = validateItems(store.items);
    _invCache = store;
    if (needsMigration) writeInv(store);   // persist the upgrade (also re-syncs _invCache)
    return _invCache;
  } catch (e) {
    console.error("[Inv] readInv error:", e.message);
    _invCache = { version: SCHEMA_VERSION, items: [] };
    return _invCache;
  }
}

// uid(), nowIso(), normalizeItem() imported from inventory-logic.js

// ─── Price History Store ──────────────────────────────────────────────────────
let _histCache = null;   // { [ean]: { ean, title, entries[] } } — populated on first readHist()

function histPath()    { return path.join(app.getPath("userData"), "price_history.json"); }
function histTmpPath() { return histPath() + ".tmp"; }

/** Atomic write for price history — same crash-safety guarantee as writeInv(). */
function writeHist(data) {
  try {
    const tmp = histTmpPath();
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, histPath());
    _histCache = data;
    return true;
  } catch (e) {
    console.error("[Hist] writeHist failed:", e.message);
    return false;
  }
}

/** Read price history — returns in-memory cache after the first disk read. */
function readHist() {
  if (_histCache) return _histCache;
  try {
    const p = histPath();
    if (!fs.existsSync(p)) { _histCache = {}; return _histCache; }
    _histCache = JSON.parse(fs.readFileSync(p, "utf8") || "{}") || {};
    return _histCache;
  } catch (e) {
    console.error("[Hist] readHist error:", e.message);
    _histCache = {};
    return _histCache;
  }
}

// ─── Network helpers ──────────────────────────────────────────────────────────
function httpGet(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https://") ? https : http;
    const req = lib.get(url, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

async function waitForHttp(url, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await httpGet(url, 1200)) > 0) return true; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, HOST);
  });
}

async function pickFreePort(from, to) {
  for (let p = from; p <= to; p++) {
    if (await isPortFree(p)) return p;
  }
  return null;
}

/** Ask the OS to assign a free ephemeral port (bind to :0). Fallback when range is exhausted. */
async function pickOsPort() {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.once("error", () => resolve(null));
    srv.once("listening", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : null;
      srv.close(() => resolve(port));
    });
    srv.listen(0, HOST);
  });
}

function apiBase() {
  if (MODE === "remote") return REMOTE_BASE;
  return `http://${HOST}:${BACKEND_PORT}`;
}

// ─── Scanner Server (Handy-Barcode) ──────────────────────────────────────────
function getLocalIP() {
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === "IPv4" && !iface.internal) return iface.address;
  }
  return "127.0.0.1";
}

function startScannerServer() {
  const htmlPath = path.join(__dirname, "assets", "scanner.html");
  const server = http.createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.method === "GET" && req.url === "/") {
      try {
        res.writeHead(200, { ...cors, "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(htmlPath, "utf8"));
      } catch { res.writeHead(404, cors); res.end("not found"); }
      return;
    }
    if (req.method === "POST" && req.url === "/scan") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const { ean } = JSON.parse(body);
          const eanStr = String(ean || "").trim();
          if (eanStr && /^\d{8,14}$/.test(eanStr)) {
            res.writeHead(200, { ...cors, "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            mainWindow?.webContents.send("scanner:ean", eanStr);
          } else {
            res.writeHead(400, cors);
            res.end(JSON.stringify({ ok: false, error: "invalid ean" }));
          }
        } catch { res.writeHead(400, cors); res.end(); }
      });
      return;
    }

    // ── Extension Bridge Routes ───────────────────────────────────────────────

    // GET /token — returns the stored JWT + expiry for the extension to use
    if (req.method === "GET" && req.url === "/token") {
      (async () => {
        try {
          const token = await getToken();
          let exp = Date.now() + 7 * 24 * 3600 * 1000;
          if (token) {
            try {
              const pl = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
              if (pl.exp) exp = pl.exp * 1000;
            } catch {}
          }
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: !!token, token: token || null, exp }));
        } catch {
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, token: null }));
        }
      })();
      return;
    }

    // GET /status — health-check / version info
    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok:      true,
        running: true,
        version: app.getVersion(),
        mode:    process.env.FLIPCHECK_MODE || "remote",
      }));
      return;
    }

    // GET /inventory — list all inventory items
    if (req.method === "GET" && req.url === "/inventory") {
      try {
        const { items } = readInv();
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, items: Array.isArray(items) ? items : [] }));
      } catch {
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, items: [] }));
      }
      return;
    }

    // POST /inventory — upsert item from extension (uses same normalizeItem() as IPC path)
    if (req.method === "POST" && req.url === "/inventory") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const raw   = JSON.parse(body);
          const store = readInv();
          const idx   = store.items.findIndex(i =>
            i.id === raw.id || (raw.ean && i.ean === raw.ean)
          );
          let upserted;
          if (idx >= 0) {
            // Merge incoming fields into existing item, then re-normalise
            store.items[idx] = normalizeItem({ ...store.items[idx], ...raw });
            upserted = store.items[idx];
          } else {
            // Brand-new item from extension — tag its origin
            upserted = normalizeItem({ source: "extension", ...raw });
            store.items.unshift(upserted);
          }
          writeInv(store);
          // Notify renderer so inventory table refreshes without reload
          mainWindow?.webContents.send("inventory:upsert-ext", upserted);
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, cors);
          res.end(JSON.stringify({ ok: false, error: "invalid_body" }));
        }
      });
      return;
    }

    res.writeHead(404, cors); res.end();
  });
  server.on("error", err => console.error("[Scanner] server error:", err.message));
  server.listen(8766, "0.0.0.0", () => console.log("[Scanner] HTTP server listening on :8766"));
  return server;
}

// ─── HTTPS Scanner Server (port 8767) — required for camera on LAN ──────────
function generateScannerCert() {
  const certDir  = path.join(app.getPath("userData"), "scanner-tls");
  const keyFile  = path.join(certDir, "server.key");
  const certFile = path.join(certDir, "server.crt");
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    fs.mkdirSync(certDir, { recursive: true });
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" ` +
        `-days 825 -nodes -subj "/CN=flipcheck-scanner"`,
        { stdio: "pipe" }
      );
    } catch (e) {
      console.error("[Scanner-TLS] openssl failed:", e.message);
      return null;
    }
  }
  try {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  } catch { return null; }
}

function startHttpsScannerServer() {
  const htmlPath = path.join(__dirname, "assets", "scanner.html");
  const sslOpts  = generateScannerCert();
  if (!sslOpts) {
    console.warn("[Scanner-TLS] No cert — HTTPS scanner not started");
    return;
  }
  const cors = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  const server = https.createServer(sslOpts, (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.method === "GET" && req.url === "/") {
      try {
        res.writeHead(200, { ...cors, "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(htmlPath, "utf8"));
      } catch { res.writeHead(404, cors); res.end("not found"); }
      return;
    }
    if (req.method === "POST" && req.url === "/scan") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        try {
          const { ean } = JSON.parse(body);
          const eanStr = String(ean || "").trim();
          if (eanStr && /^\d{8,14}$/.test(eanStr)) {
            res.writeHead(200, { ...cors, "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            mainWindow?.webContents.send("scanner:ean", eanStr);
          } else {
            res.writeHead(400, cors);
            res.end(JSON.stringify({ ok: false, error: "invalid ean" }));
          }
        } catch { res.writeHead(400, cors); res.end(); }
      });
      return;
    }
    res.writeHead(404, cors); res.end();
  });
  server.on("error", err => console.error("[Scanner-TLS] error:", err.message));
  server.listen(8767, "0.0.0.0", () => console.log("[Scanner-TLS] HTTPS server listening on :8767"));
  return server;
}

// ─── Backend Spawn ────────────────────────────────────────────────────────────
function getBackendDir() {
  return IS_PROD
    ? path.join(process.resourcesPath, "Backend")
    : path.join(__dirname, "..", "services", "auth");
}

function startBackend(port) {
  const dir = getBackendDir();
  const python = IS_PROD ? "python" : (() => {
    const venv = path.join(dir, ".venv", "Scripts", "python.exe");
    return fs.existsSync(venv) ? venv : "python";
  })();

  backendProc = spawn(python, ["-m", "uvicorn", "flipcheck_app:app", "--host", HOST, "--port", String(port), "--log-level", "warning"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  backendProc.stdout.on("data", d => console.log("[backend]", d.toString().trim()));
  backendProc.stderr.on("data", d => console.error("[backend:err]", d.toString().trim()));
  backendProc.on("exit", (code, signal) => {
    console.log("[backend] exit:", code, signal);
    // Restart once on unexpected crash — skip if app is shutting down or already restarting
    if (!_backendRestarting && code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL") {
      _backendRestarting = true;
      console.log("[backend] Unexpected exit — restarting in 2s…");
      setTimeout(() => {
        _backendRestarting = false;
        startBackend(port); // reuse same port that was already confirmed free
      }, 2000);
    }
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#0A0A0F",
    title: "FLIPCHECK",
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0A0A0F", symbolColor: "#ffffff", height: 32 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // DevTools toggle (Cmd+Alt+I / Ctrl+Shift+I)
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    const isMac = process.platform === "darwin";
    const toggle = isMac
      ? input.meta && input.alt && input.key.toLowerCase() === "i"
      : input.control && input.shift && input.key.toLowerCase() === "i";
    if (toggle) {
      mainWindow.webContents.isDevToolsOpened()
        ? mainWindow.webContents.closeDevTools()
        : mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  // External links open in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(APP_HTML);
}

// ─── Protocol handler ─────────────────────────────────────────────────────────
function parseToken(url) {
  try {
    const u = new URL(url);
    return u.protocol === "flipcheck:" ? u.searchParams.get("token") : null;
  } catch { return null; }
}

if (process.defaultApp) {
  app.setAsDefaultProtocolClient("flipcheck", process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient("flipcheck");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", async (_e, argv) => {
    const deep = argv.find(a => typeof a === "string" && a.startsWith("flipcheck://"));
    if (!deep) return;
    const token = parseToken(deep);
    if (!token) return;
    await saveToken(token);
    if (mainWindow) { mainWindow.webContents.send("auth:token", token); mainWindow.show(); mainWindow.focus(); }
  });
}

app.on("open-url", async (e, url) => {
  e.preventDefault();
  const token = parseToken(url);
  if (!token) return;
  await saveToken(token);
  if (mainWindow) { mainWindow.webContents.send("auth:token", token); mainWindow.show(); mainWindow.focus(); }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  app.setName("FLIPCHECK");

  let _backendReady = true; // false → send backend:unavailable after window is created

  if (MODE === "local") {
    // Try the fixed port range first (deterministic, easier to debug)
    BACKEND_PORT = await pickFreePort(PORT_FROM, PORT_TO);
    if (!BACKEND_PORT) {
      console.warn(`[Backend] No free port in ${PORT_FROM}–${PORT_TO} — trying OS-assigned port`);
      BACKEND_PORT = await pickOsPort();
    }
    if (BACKEND_PORT) {
      startBackend(BACKEND_PORT);
      const ready = await waitForHttp(`http://${HOST}:${BACKEND_PORT}/health`, 12000);
      if (!ready) {
        console.error("[Backend] Did not respond to /health within 12 s — marking unavailable");
        _backendReady = false;
      }
    } else {
      console.error("[Backend] Could not acquire any local port — marking unavailable");
      _backendReady = false;
    }
  }

  createWindow();

  // Notify the renderer if the backend never came up (delay so the renderer can load first)
  if (MODE === "local" && !_backendReady) {
    setTimeout(() => {
      mainWindow?.webContents.send("backend:unavailable", { reason: "startup_failed" });
    }, 3000);
  }

  // Barcode scanner servers — HTTP :8766 (bridge) + HTTPS :8767 (camera)
  startScannerServer();
  startHttpsScannerServer();

  // Background competition monitor (webhook fire when undercut / new listings)
  startCompetitionMonitor();

  // Auto-updater — only in packaged production builds
  if (IS_PROD && autoUpdater) {
    try {
      autoUpdater.on("update-available",  info => mainWindow?.webContents.send("updater:available",  info));
      autoUpdater.on("update-downloaded", info => mainWindow?.webContents.send("updater:downloaded", info));
      autoUpdater.on("error", err => console.error("[Updater]", err.message));
      setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 5000);
    } catch (e) { console.error("[Updater] setup failed:", e.message); }
  }
});

app.on("window-all-closed", () => {
  _backendRestarting = true; // prevent the exit handler from re-spawning
  if (backendProc) { try { backendProc.kill(); } catch {} }
  app.quit();
});

// ─── IPC: Config ──────────────────────────────────────────────────────────────
ipcMain.handle("cfg:backendBase", () => apiBase());
ipcMain.handle("cfg:mode", () => MODE);
ipcMain.handle("cfg:version", () => APP_VERSION);
ipcMain.handle("cfg:requireAuth", () => IS_PROD); // In dev/local mode: no auth required

// ─── IPC: Auth ────────────────────────────────────────────────────────────────
ipcMain.handle("auth:getToken", async () => {
  const token = await getToken();
  return { token };
});
ipcMain.handle("auth:login", () => shell.openExternal(AUTH_URL));
ipcMain.handle("auth:logout", async () => { await deleteToken(); return { ok: true }; });

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle("settings:get", () => loadSettings());
ipcMain.handle("settings:set", (_e, data) => saveSettings(data));

// ─── IPC: Device ──────────────────────────────────────────────────────────────
ipcMain.handle("device:fingerprint", () => {
  const raw = [os.hostname(), os.userInfo().username, os.platform(), os.arch()].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
});

// ─── IPC: Inventory ───────────────────────────────────────────────────────────
ipcMain.handle("inventory:list", () => {
  const { items } = readInv();
  return [...items].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
});

ipcMain.handle("inventory:upsert", (_e, item) => {
  const store = readInv();
  const norm = normalizeItem(item);
  const idx = store.items.findIndex(i => i.id === norm.id);
  if (idx >= 0) store.items[idx] = { ...store.items[idx], ...norm };
  else store.items.push(norm);
  writeInv(store);
  return norm;
});

ipcMain.handle("inventory:delete", (_e, { id }) => {
  const store = readInv();
  store.items = store.items.filter(i => i.id !== id);
  writeInv(store);
  return { ok: true };
});

ipcMain.handle("inventory:bulkUpdate", (_e, { ids, patch }) => {
  const store = readInv();
  const idSet = new Set(ids);
  store.items = store.items.map(i => {
    if (!idSet.has(i.id)) return i;
    return normalizeItem({ ...i, ...patch });
  });
  writeInv(store);
  return { ok: true, count: ids.length };
});

ipcMain.handle("inventory:clear", () => {
  backupInv();   // save a .bak before wiping — user can recover if needed
  writeInv({ version: SCHEMA_VERSION, items: [] });
  return { ok: true };
});

// ─── IPC: Price History ───────────────────────────────────────────────────────
ipcMain.handle("priceHistory:save", (_e, entry) => {
  const data = readHist();
  const { ean, title, ...rest } = entry;
  if (!data[ean]) data[ean] = { ean, title: title || ean, entries: [] };
  if (title) data[ean].title = title;
  data[ean].entries.push({ ts: nowIso(), ...rest });
  // Keep last 180 entries per EAN
  if (data[ean].entries.length > 180) data[ean].entries = data[ean].entries.slice(-180);
  // Cap total unique EANs at 1000 — evict the EANs whose last entry is oldest
  const eans = Object.keys(data);
  if (eans.length > 1000) {
    eans.sort((a, b) => {
      const la = data[a].entries[data[a].entries.length - 1]?.ts || "";
      const lb = data[b].entries[data[b].entries.length - 1]?.ts || "";
      return la.localeCompare(lb); // ascending → least-recently-updated first
    });
    eans.slice(0, eans.length - 1000).forEach(k => delete data[k]);
  }
  writeHist(data);
  return { ok: true };
});

ipcMain.handle("priceHistory:get", (_e, ean) => {
  const data = readHist();
  return data[ean] || { ean, title: ean, entries: [] };
});

ipcMain.handle("priceHistory:list", () => {
  const data = readHist();
  return Object.values(data).map(d => ({
    ean: d.ean,
    title: d.title,
    count: d.entries.length,
    last_ts: d.entries[d.entries.length - 1]?.ts || null,
    last_price: d.entries[d.entries.length - 1]?.browse_median || null,
  }));
});

ipcMain.handle("priceHistory:deleteEan", (_e, ean) => {
  const data = readHist();
  delete data[ean];
  writeHist(data);
  return { ok: true };
});

// Remove all EANs whose most-recent entry is older than 90 days.
// Safe to call at any time (e.g. from Settings → "Daten bereinigen").
ipcMain.handle("priceHistory:vacuum", () => {
  const data = readHist();
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  let removed = 0;
  for (const ean of Object.keys(data)) {
    const lastTs = (data[ean].entries[data[ean].entries.length - 1]?.ts || "").slice(0, 10);
    if (!lastTs || lastTs < cutoff) { delete data[ean]; removed++; }
  }
  if (removed > 0) writeHist(data);
  return { ok: true, removed };
});

// Saves 30-day daily series from eBay Research (metricsTrends).
// price_series: [[epoch_ms, avg_price], ...]
// qty_series:   [[epoch_ms, qty], ...]     (optional, same length, matched by index)
// Entries are deduped by day (yyyy-mm-dd) — existing days are NOT overwritten.
ipcMain.handle("priceHistory:saveSeries", (_e, { ean, title, price_series, qty_series }) => {
  if (!ean || !Array.isArray(price_series) || price_series.length === 0) return { ok: false };
  const data = readHist();
  if (!data[ean]) data[ean] = { ean, title: title || ean, entries: [] };
  if (title) data[ean].title = title;

  // Build a set of existing dates (yyyy-mm-dd) to avoid duplicates
  const existingDays = new Set(
    data[ean].entries.map(e => (e.ts || "").slice(0, 10))
  );

  // Build a qty lookup: epoch_ms → qty
  const qtyMap = new Map((qty_series || []).map(([ts, q]) => [ts, q]));

  let added = 0;
  for (const [epochMs, price] of price_series) {
    if (price == null) continue;
    const day = new Date(epochMs).toISOString().slice(0, 10);
    if (existingDays.has(day)) continue;   // skip — already have data for this day
    existingDays.add(day);
    data[ean].entries.push({
      ts:           new Date(epochMs).toISOString(),
      research_avg: price,                 // daily avg sold price from Research
      qty:          qtyMap.get(epochMs) ?? null,  // daily units sold
      from_series:  true,                  // flag: came from metricsTrends, not a live check
    });
    added++;
  }

  // Sort entries chronologically and cap at 365
  data[ean].entries.sort((a, b) => a.ts.localeCompare(b.ts));
  if (data[ean].entries.length > 365) data[ean].entries = data[ean].entries.slice(-365);

  writeHist(data);
  return { ok: true, added };
});

// ─── IPC: Seller Tracker ──────────────────────────────────────────────────────
const SELLERS_FILE = path.join(app.getPath("userData"), "tracked_sellers.json");

function readSellers() {
  try {
    if (!fs.existsSync(SELLERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(SELLERS_FILE, "utf8") || "[]") || [];
  } catch { return []; }
}

function writeSellers(list) {
  try { fs.writeFileSync(SELLERS_FILE, JSON.stringify(list, null, 2), "utf8"); } catch {}
}

ipcMain.handle("competition:list",   () => readSellers());

ipcMain.handle("competition:add", (_e, username) => {
  const list = readSellers();
  if (!list.find(s => s.username === username)) {
    list.unshift({ username, added_at: new Date().toISOString(), listing_count: null });
    writeSellers(list);
  }
  return readSellers();
});

ipcMain.handle("competition:remove", (_e, username) => {
  writeSellers(readSellers().filter(s => s.username !== username));
  return readSellers();
});

ipcMain.handle("competition:updateCount", (_e, { username, count, feedback_score, feedback_pct }) => {
  const list = readSellers();
  const s = list.find(x => x.username === username);
  if (s) {
    s.listing_count = count;
    s.last_checked  = new Date().toISOString();
    if (feedback_score != null) s.feedback_score = feedback_score;
    if (feedback_pct  != null) s.feedback_pct   = feedback_pct;
  }
  writeSellers(list);
  return { ok: true };
});

// ─── Background Competition Monitor ──────────────────────────────────────────
const COMP_CACHE_FILE = path.join(app.getPath("userData"), "comp_monitor_cache.json");
let _monitorTimer   = null;
let _monitorRunning = false;

function readCompCache() {
  try {
    if (!fs.existsSync(COMP_CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(COMP_CACHE_FILE, "utf8") || "{}");
  } catch { return {}; }
}
function writeCompCache(data) {
  try { fs.writeFileSync(COMP_CACHE_FILE, JSON.stringify(data, null, 2), "utf8"); } catch {}
}

// HTTP/HTTPS GET from main process (no renderer involved)
function mainApiCall(urlStr, token) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlStr);
    const mod  = url.protocol === "https:" ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname + url.search,
      method:   "GET",
      headers:  { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
    };
    const req = mod.request(opts, res => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// Fire a Discord embed webhook
function fireDiscordWebhook(webhookUrl, eventId, data) {
  const colors = { undercut: 0xEF4444, new_listing: 0xF59E0B, price_drop: 0xF59E0B, verdict_change: 0x6366F1, new_seller: 0x6366F1 };
  const icons  = { undercut: "⚠️",    new_listing: "🆕",      price_drop: "📉",      verdict_change: "🔄",     new_seller: "👤" };
  const labels = {
    undercut:       "Günstigster Konkurrent unterboten",
    new_listing:    "Neues Listing von beobachtetem Verkäufer",
    price_drop:     "Preis deutlich gesunken",
    verdict_change: "Flipcheck Verdict geändert",
    new_seller:     "Neuer Konkurrent aufgetaucht",
  };
  const fmt = v => v != null ? `€${parseFloat(v).toFixed(2)}` : "—";
  const fields = [];
  if (eventId === "undercut") {
    if (data.myPrice  != null) fields.push({ name: "Dein VK",    value: fmt(data.myPrice),  inline: true });
    if (data.cheapest != null) fields.push({ name: "Konkurrent", value: fmt(data.cheapest), inline: true });
    if (data.myPrice != null && data.cheapest != null)
      fields.push({ name: "Differenz", value: fmt(data.myPrice - data.cheapest), inline: true });
    if (data.total != null) fields.push({ name: "Anbieter", value: String(data.total), inline: true });
  } else if (eventId === "new_listing") {
    if (data.username != null) fields.push({ name: "Verkäufer", value: `@${data.username}`, inline: true });
    if (data.count    != null) fields.push({ name: "Listings",  value: String(data.count),  inline: true });
    if (data.newCount != null) fields.push({ name: "Neu",       value: `+${data.newCount}`, inline: true });
  }
  const productName = data.product || data.title || data.ean || "Produkt";
  const payload = JSON.stringify({
    username: "Flipcheck",
    embeds: [{
      color:       colors[eventId] || 0x6366F1,
      author:      { name: "▲ FLIPCHECK" },
      title:       `${icons[eventId] || "🔔"} ${labels[eventId] || eventId}`,
      description: `**${productName}**`,
      fields,
      footer:    { text: `Flipcheck · ${new Date().toLocaleString("de-DE")}` },
      timestamp: new Date().toISOString(),
    }],
  });
  return new Promise((resolve, reject) => {
    const url  = new URL(webhookUrl);
    const opts = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname + url.search,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    };
    const req = https.request(opts, res => {
      res.resume();
      if (res.statusCode === 204 || res.statusCode === 200) resolve(true);
      else reject(new Error(`Discord HTTP ${res.statusCode}`));
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(payload);
    req.end();
  });
}

async function runCompetitionMonitor() {
  if (_monitorRunning) return;
  _monitorRunning = true;
  console.log("[Monitor] Competition check started");
  try {
    const settings   = loadSettings();
    const webhookUrl = settings.webhook_url;
    const events     = settings.webhook_events || {};
    if (!webhookUrl) { console.log("[Monitor] No webhook URL configured, skipping."); return; }

    const token = await getToken();
    const base  = apiBase();
    const cache = readCompCache();
    const now   = new Date().toISOString();

    // ── Inventory: undercut check ─────────────────────────────────────────
    if (events.undercut !== false) {
      const inv    = readInv();
      const active = (inv.items || []).filter(i =>
        ["IN_STOCK","LISTED","LISTING_PENDING"].includes(i.status) && i.ean && i.sell_price
      );
      for (const item of active) {
        try {
          const res = await mainApiCall(
            `${base}/ean/competition?ean=${encodeURIComponent(item.ean)}&limit=10`, token
          );
          if (res.status === 200 && res.data?.ok) {
            const items    = res.data.items || [];
            const cheapest = items[0]?.total_price ?? null;
            const myPrice  = item.sell_price;
            const ckey     = `inv_${item.id}`;
            const prev     = cache[ckey] || {};
            if (cheapest != null && myPrice != null && cheapest < myPrice - 0.01) {
              const wasUndercut    = (prev.cheapest ?? Infinity) < myPrice - 0.01;
              const deeperUndercut = wasUndercut && (prev.cheapest - cheapest) > 0.50;
              if (!wasUndercut || deeperUndercut) {
                await fireDiscordWebhook(webhookUrl, "undercut", {
                  myPrice, cheapest, product: item.title || item.ean, total: res.data.total,
                }).catch(e => console.error("[Monitor] webhook error:", e.message));
              }
            }
            cache[ckey] = { cheapest, myPrice, checkedAt: now };
          }
          await new Promise(r => setTimeout(r, 600));
        } catch (e) { console.error(`[Monitor] inv error ${item.ean}:`, e.message); }
      }
    }

    // ── Sellers: new listing check ────────────────────────────────────────
    if (events.new_listing !== false) {
      const sellers = readSellers();
      for (const seller of sellers) {
        try {
          const res = await mainApiCall(
            `${base}/seller/listings?seller_id=${encodeURIComponent(seller.username)}&limit=1`, token
          );
          if (res.status === 200 && res.data?.ok) {
            const currentCount = res.data.total || 0;
            const ckey         = `seller_${seller.username}`;
            const prev         = cache[ckey] || {};
            const prevCount    = prev.count ?? null;
            if (prevCount !== null && currentCount > prevCount) {
              await fireDiscordWebhook(webhookUrl, "new_listing", {
                username: seller.username, count: currentCount, newCount: currentCount - prevCount,
              }).catch(e => console.error("[Monitor] webhook error:", e.message));
            }
            cache[ckey] = { count: currentCount, checkedAt: now };
          }
          await new Promise(r => setTimeout(r, 600));
        } catch (e) { console.error(`[Monitor] seller error ${seller.username}:`, e.message); }
      }
    }

    cache._lastRun = now;
    writeCompCache(cache);
    console.log("[Monitor] Competition check complete");
  } finally {
    _monitorRunning = false;
  }
}

function startCompetitionMonitor() {
  if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
  const settings    = loadSettings();
  const intervalMin = Math.max(5, settings.monitor_interval_min || 15);
  _monitorTimer = setInterval(runCompetitionMonitor, intervalMin * 60 * 1000);
  // First run after 45s (give local backend time to start)
  setTimeout(runCompetitionMonitor, 45 * 1000);
  console.log(`[Monitor] Started — interval: ${intervalMin} min`);
}

ipcMain.handle("competition:monitorStatus", () => {
  const cache       = readCompCache();
  const settings    = loadSettings();
  const intervalMin = settings.monitor_interval_min || 15;
  return {
    active:      !!_monitorTimer,
    running:     _monitorRunning,
    lastRun:     cache._lastRun || null,
    intervalMin,
    webhookSet:  !!(settings.webhook_url),
  };
});

ipcMain.handle("competition:setMonitorInterval", (_e, intervalMin) => {
  saveSettings({ ...loadSettings(), monitor_interval_min: Math.max(5, intervalMin || 15) });
  startCompetitionMonitor();
  return { ok: true };
});

// ─── IPC: Price Alerts ────────────────────────────────────────────────────────
const { Notification: ElectronNotif } = require("electron");
const ALERTS_FILE = path.join(app.getPath("userData"), "price_alerts.json");

function readAlerts() {
  try {
    if (!fs.existsSync(ALERTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8") || "[]") || [];
  } catch { return []; }
}
function writeAlerts(list) {
  try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(list, null, 2), "utf8"); } catch {}
}

ipcMain.handle("alerts:list", () => readAlerts());

ipcMain.handle("alerts:add", (_e, { ean, target_price, title }) => {
  const list = readAlerts();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  list.unshift({
    id, ean,
    title:           title || null,
    target_price:    parseFloat(target_price),
    created_at:      new Date().toISOString(),
    last_checked:    null,
    last_price:      null,
    triggered:       false,
    triggered_at:    null,
    triggered_price: null,
    active:          true,
    check_count:     0,
  });
  writeAlerts(list);
  return readAlerts();
});

ipcMain.handle("alerts:remove", (_e, id) => {
  writeAlerts(readAlerts().filter(a => a.id !== id));
  return readAlerts();
});

ipcMain.handle("alerts:update", (_e, patch) => {
  const list = readAlerts();
  const idx  = list.findIndex(a => a.id === patch.id);
  if (idx !== -1) {
    // Track trigger history when an alert is newly triggered
    if (patch.triggered && patch.triggered_price != null) {
      const hist = list[idx].trigger_history || [];
      hist.push({ ts: patch.triggered_at || new Date().toISOString(), price: patch.triggered_price });
      patch.trigger_history = hist.slice(-20); // keep last 20 entries
    }
    Object.assign(list[idx], patch);
  }
  writeAlerts(list);
  return readAlerts();
});

ipcMain.handle("alerts:reset", (_e, id) => {
  const list = readAlerts();
  const a = list.find(x => x.id === id);
  if (a) {
    a.triggered = false; a.triggered_at = null;
    a.triggered_price = null; a.active = true;
    a.trigger_history = []; // clear history on reset
  }
  writeAlerts(list);
  return readAlerts();
});

ipcMain.handle("notify", (_e, title, body) => {
  try {
    if (ElectronNotif.isSupported()) {
      new ElectronNotif({ title, body }).show();
    }
  } catch {}
  return true;
});

// ─── IPC: Scanner ─────────────────────────────────────────────────────────────
ipcMain.handle("scanner:getInfo", () => {
  const ip = getLocalIP();
  return { url: `https://${ip}:8767`, ip };
});

// ─── IPC: Auto-Updater ────────────────────────────────────────────────────────
ipcMain.handle("updater:check", async () => {
  if (!IS_PROD || !autoUpdater) return { checking: false, reason: "dev mode or unavailable" };
  try { await autoUpdater.checkForUpdatesAndNotify(); return { checking: true }; }
  catch (e) { return { checking: false, error: e.message }; }
});

ipcMain.handle("updater:install", () => {
  if (autoUpdater) try { autoUpdater.quitAndInstall(); } catch {}
});
