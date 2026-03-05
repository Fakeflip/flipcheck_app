/**
 * Flipcheck v2 — Tests: loadSettings, saveSettings
 * Covers: settingsStore.js (mocks Electron's `app` module)
 */

"use strict";

const os   = require("os");
const path = require("path");
const fs   = require("fs");

// ── Temp directory used by all tests in this file ──────────────────────────
const TMP_DIR = path.join(os.tmpdir(), `fc-settings-test-${process.pid}`);
const SETTINGS_FILE = path.join(TMP_DIR, "settings_v2.json");

// ── Mock `electron` before settingsStore.js is required ────────────────────
// Jest hoists jest.mock() before imports/requires so the mock is active when
// settingsStore.js calls require('electron') at module level.
jest.mock("electron", () => {
  const os   = require("os");
  const path = require("path");
  return {
    app: {
      getPath: () => path.join(os.tmpdir(), `fc-settings-test-${process.pid}`),
    },
  };
});

// Now safe to require the module under test
const { loadSettings, saveSettings } = require("../../settingsStore.js");

// ── Test lifecycle ──────────────────────────────────────────────────────────
beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  // Start each test with no settings file (clean slate)
  if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
});

afterAll(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// ─────────────────────────────────────────────────────────────────────────────
// loadSettings
// ─────────────────────────────────────────────────────────────────────────────

describe("loadSettings()", () => {
  test("returns {} when settings file does not exist (first run)", () => {
    expect(loadSettings()).toEqual({});
  });

  test("returns persisted settings from disk", () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ theme: "dark", ek_mode: "netto" }));
    expect(loadSettings()).toEqual({ theme: "dark", ek_mode: "netto" });
  });

  test("returns {} for corrupt (non-JSON) file", () => {
    fs.writeFileSync(SETTINGS_FILE, "not {{ valid json ]]");
    expect(loadSettings()).toEqual({});
  });

  test("returns {} for empty file", () => {
    fs.writeFileSync(SETTINGS_FILE, "");
    expect(loadSettings()).toEqual({});
  });

  test("returns {} when file contains a JSON string (non-object)", () => {
    fs.writeFileSync(SETTINGS_FILE, '"just a string"');
    expect(loadSettings()).toEqual({});
  });

  test("returns {} when file contains a JSON array (non-object)", () => {
    fs.writeFileSync(SETTINGS_FILE, "[]");
    expect(loadSettings()).toEqual({});
  });

  test("returns {} when file contains JSON null", () => {
    fs.writeFileSync(SETTINGS_FILE, "null");
    expect(loadSettings()).toEqual({});
  });

  test("reads nested objects correctly", () => {
    const settings = { nested: { a: 1, b: [1, 2, 3] }, flag: true };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings));
    expect(loadSettings()).toEqual(settings);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveSettings
// ─────────────────────────────────────────────────────────────────────────────

describe("saveSettings()", () => {
  test("persists the settings object to disk", () => {
    saveSettings({ cat: "sonstiges", mwst: "brutto" });
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    expect(raw).toEqual({ cat: "sonstiges", mwst: "brutto" });
  });

  test("returns the saved object", () => {
    const obj = { vat_mode: "netto" };
    expect(saveSettings(obj)).toEqual(obj);
  });

  test("round-trips: saved settings can be read back with loadSettings()", () => {
    const settings = { key: "value", num: 42 };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  test("handles null gracefully — saves and returns {}", () => {
    const result = saveSettings(null);
    expect(result).toEqual({});
    // File should contain valid JSON {}
    expect(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))).toEqual({});
  });

  test("overwrites previous settings", () => {
    saveSettings({ old: "value" });
    saveSettings({ new: "value" });
    expect(loadSettings()).toEqual({ new: "value" });
  });

  test("creates the settings directory if missing", () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    saveSettings({ x: 1 });
    expect(fs.existsSync(TMP_DIR)).toBe(true);
    expect(fs.existsSync(SETTINGS_FILE)).toBe(true);
  });

  test("writes pretty-printed JSON (human-readable)", () => {
    saveSettings({ a: 1 });
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    // Pretty-printed JSON has newlines
    expect(raw).toContain("\n");
  });

  test("nested objects are preserved after round-trip", () => {
    const obj = { nested: { a: 1, b: [1, 2, 3] }, flag: true };
    saveSettings(obj);
    expect(loadSettings()).toEqual(obj);
  });
});
