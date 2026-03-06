// customSign.js — fixes "resource fork / detritus not allowed" on macOS Sonoma/Sequoia.
//
// Root cause: macOS re-adds com.apple.provenance + com.apple.FinderInfo xattrs to
// each file when accessed by ANY process, even after xattr -cr. Stripping once before
// signing is not enough because @electron/osx-sign calls codesign per-file sequentially.
//
// Why monkey-patching exports.execFileAsync doesn't work:
//   sign.js uses: const { execFileAsync } = require('./util')
//   That destructured local binding is NOT updated when we patch util.execFileAsync later.
//
// Fix: directly patch the compiled sign.js source on disk (once, guarded by a marker),
// then clear Node's require cache so signAsync loads the patched version.
"use strict";

const { execSync } = require("child_process");
const fs           = require("fs");
const path         = require("path");

// ── Locate and patch @electron/osx-sign/dist/cjs/sign.js ─────────────────────

const SIGN_JS = path.resolve(
  __dirname, "..", "node_modules", "@electron", "osx-sign", "dist", "cjs", "sign.js"
);

const MARKER   = "/*__xattr_patched__*/";

// The exact line in sign.js that calls codesign per-file (verified against 0.6.0 / 1.0.x):
const OLD_LINE =
  "await (0, util_1.execFileAsync)('codesign', perFileArgs.concat('--entitlements', perFileOptions.entitlements, filePath));";

// Replacement: strip xattrs immediately before codesign so macOS detritus is gone
const NEW_LINE =
  `${MARKER} try { require('child_process').execSync('/usr/bin/xattr -cr "' + filePath.replace(/"/g, '\\\\"') + '"', {stdio:'pipe'}); } catch(_){} ` +
  OLD_LINE;

const src = fs.readFileSync(SIGN_JS, "utf8");

if (!src.includes(MARKER)) {
  const patched = src.replace(OLD_LINE, NEW_LINE);

  if (!patched.includes(MARKER)) {
    // Fallback: dump what the file actually has so we can update OLD_LINE
    const lines = src.split("\n");
    const idx   = lines.findIndex(l => l.includes("execFileAsync") && l.includes("perFileArgs"));
    console.error("[customSign] ERROR: target line not found in sign.js!");
    console.error("[customSign] Closest match (line", idx + 1, "):", lines[idx] || "(not found)");
    throw new Error("[customSign] Patch failed — see above. Update OLD_LINE in build/customSign.js.");
  }

  fs.writeFileSync(SIGN_JS, patched, "utf8");

  // Invalidate Node's require cache for every osx-sign module so signAsync reloads the patched file
  const OSX_SIGN_DIR = path.resolve(__dirname, "..", "node_modules", "@electron", "osx-sign");
  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(OSX_SIGN_DIR)) delete require.cache[k];
  });

  console.log("  • xattr patch written to @electron/osx-sign/dist/cjs/sign.js");
} else {
  console.log("  • xattr patch already present in sign.js (skipping rewrite)");
}

// ── Sign ───────────────────────────────────────────────────────────────────────

/**
 * @param {import("@electron/osx-sign").SignOptions} opts
 */
exports.default = async (opts) => {
  // Require AFTER cache invalidation so we get the patched sign.js
  const { signAsync } = require("@electron/osx-sign");
  return signAsync(opts);
};
