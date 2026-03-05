// @ts-check
/* Flipcheck v2 — html tagged-template helper
 *
 * Usage:
 *   innerHTML = html`<div class="${cls}">${userText}</div>`;
 *   // → userText is HTML-escaped automatically
 *
 *   innerHTML = html`<div>${html.safe(trustedSvgString)}</div>`;
 *   // → html.safe() bypasses escaping for already-safe markup
 *
 * Why not just use esc()? Raw template literals give no visual signal about
 * whether each interpolated value is escaped or not. This helper makes the
 * default safe (escape) and the bypass explicit (html.safe()).
 *
 * Array values are joined with "" so you can interpolate renderRow() results:
 *   html`<ul>${items.map(renderRow)}</ul>`
 */

"use strict";

/**
 * The sentinel symbol used to mark trusted/pre-escaped values.
 * @type {symbol}
 */
const _SAFE = Symbol("html.safe");

/**
 * HTML-escape a plain string value.
 * @param {unknown} s
 * @returns {string}
 */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tagged template literal that auto-escapes all interpolated values.
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {string}
 */
function html(strings, ...values) {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (Array.isArray(v)) {
        // Flat-join arrays — useful for mapped row lists
        out += v.join("");
      } else if (v != null && typeof v === "object" && /** @type {any} */ (v)[_SAFE] === true) {
        // html.safe() sentinel — bypass escaping for trusted markup
        out += /** @type {any} */ (v).value;
      } else {
        out += _esc(v);
      }
    }
  }
  return out;
}

/**
 * Mark a string as trusted/pre-escaped so the `html` tag won't escape it.
 * Use ONLY for strings you fully control (e.g. SVG literals, server-rendered HTML).
 *
 * @param {string} rawHtml
 * @returns {{ [key: symbol]: boolean, value: string }}
 */
html.safe = function safe(rawHtml) {
  return { [_SAFE]: true, value: String(rawHtml) };
};
