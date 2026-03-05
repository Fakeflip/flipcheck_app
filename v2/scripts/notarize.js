'use strict';

/**
 * electron-builder afterSign hook — runs after every macOS app sign.
 * Submits the signed .app to Apple's notarization service (notarytool).
 *
 * Required GitHub Secrets / env vars:
 *   APPLE_ID                    — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — App-Specific Password (appleid.apple.com → Security)
 *   APPLE_TEAM_ID               — 10-char Team ID (developer.apple.com → Membership)
 *
 * Notarization is skipped silently if APPLE_ID is not set (local dev builds).
 */

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  if (!process.env.APPLE_ID) {
    console.log('[notarize] APPLE_ID not set — skipping notarization (local build)');
    return;
  }
  if (!process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    throw new Error('[notarize] APPLE_APP_SPECIFIC_PASSWORD is required for notarization');
  }
  if (!process.env.APPLE_TEAM_ID) {
    throw new Error('[notarize] APPLE_TEAM_ID is required for notarization');
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  console.log(`[notarize] Submitting ${appPath} to Apple…`);

  await notarize({
    tool:             'notarytool',
    appPath,
    appleId:          process.env.APPLE_ID,
    appleIdPassword:  process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId:           process.env.APPLE_TEAM_ID,
  });

  console.log('[notarize] Notarization complete ✓');
};
