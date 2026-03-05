// @ts-check
/* Flipcheck v2 — Settings persistence (main process) */

const fs   = require("fs");
const path = require("path");
const { app } = require("electron");

/** @returns {string} Absolute path to the settings JSON file. */
function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings_v2.json");
}

/**
 * Load persisted app settings from disk.
 * Returns an empty object on first run or if the file is corrupt / missing.
 * @returns {import('./assets/lib/types.js').FC_Settings}
 */
function loadSettings() {
  try {
    const p = getSettingsPath();
    if (!fs.existsSync(p)) return {};
    const raw  = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * Persist the given settings object to disk (pretty-printed JSON).
 * Creates the settings directory if it does not exist.
 * Returns the saved object (or the input on write error).
 *
 * @param {import('./assets/lib/types.js').FC_Settings} obj
 * @returns {import('./assets/lib/types.js').FC_Settings}
 */
function saveSettings(obj) {
  try {
    const p = getSettingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj || {}, null, 2), "utf8");
    return obj || {};
  } catch {
    return obj || {};
  }
}

module.exports = { loadSettings, saveSettings };
