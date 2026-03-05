// @ts-check
/* Flipcheck v2 — Error Reporter
 * Sends uncaught errors + manual reports to Discord webhook.
 * Features: deduplication (30s), rate-limit (10/min), stack capture.
 */
const ErrorReporter = (() => {
  const WEBHOOK    = "https://discord.com/api/webhooks/1478520342233223169/Xm8AEoSvduusadIVPEv4z9XgNIACyosfB3wtV4ZtiHbAcVQrETFU5qHl1ABDswdfh6VM";
  const DEDUP_MS   = 30_000;   // same error within 30s → skip
  const MAX_PM     = 10;       // max 10 reports per minute

  /** @type {number}           */ let _count  = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */ let _resetT = null;
  /** @type {Map<string, number>} */ const _seen = new Map(); // fingerprint → last_ts

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Build a short fingerprint from error message + context for deduplication.
   * @param {string} msg
   * @param {string} ctx
   * @returns {string}
   */
  function _fp(msg, ctx) {
    return (String(msg) + String(ctx)).slice(0, 120);
  }

  /** @returns {string} */
  function _view() {
    try { return /** @type {any} */ (window).App?.currentView || "—"; } catch { return "—"; }
  }

  /** @returns {string} */
  function _version() {
    try { return document.getElementById("appVersion")?.textContent || "?"; } catch { return "?"; }
  }

  // ── Core report ─────────────────────────────────────────────────────────────

  /**
   * Report an error to the Discord webhook (fire-and-forget).
   * Silent on any failure — never throws.
   *
   * @param {Error|string|unknown} error   - The error or message to report
   * @param {string}               [context] - Optional label for where the error occurred
   * @returns {Promise<void>}
   */
  async function report(error, context = "") {
    try {
      const msg   = (error instanceof Error ? error.message : String(error)).trim();
      const stack = error instanceof Error ? (error.stack || "").slice(0, 600) : "";

      // Dedup
      const fp  = _fp(msg, context);
      const now = Date.now();
      if (_seen.has(fp) && now - (_seen.get(fp) ?? 0) < DEDUP_MS) return;
      _seen.set(fp, now);

      // Rate-limit
      if (_count >= MAX_PM) return;
      _count++;
      if (!_resetT) {
        _resetT = setTimeout(() => { _count = 0; _resetT = null; }, 60_000);
      }

      /** @type {Array<{name: string, value: string, inline: boolean}>} */
      const fields = [
        { name: "🔴 Fehler",    value: `\`\`\`${msg.slice(0, 500)}\`\`\``, inline: false },
      ];
      if (stack) fields.push({ name: "📋 Stack", value: `\`${stack.slice(0, 450)}\``, inline: false });
      fields.push(
        { name: "📍 View",    value: _view(),                                     inline: true },
        { name: "🔧 Kontext", value: context ? String(context).slice(0, 60) : "—", inline: true },
        { name: "📦 Version", value: _version(),                                   inline: true },
        { name: "🕐 Zeit",    value: new Date().toLocaleString("de-DE"),            inline: true },
      );

      await fetch(WEBHOOK, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title:     "⚠️ Flipcheck App Error",
            color:     15548997,   // #ED4245
            fields,
            footer:    { text: "Flipcheck Error Reporter" },
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    } catch {
      // Never throw — reporting must be silent
    }
  }

  // ── Public ──────────────────────────────────────────────────────────────────
  return { report };
})();
