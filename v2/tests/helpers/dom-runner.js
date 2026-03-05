/**
 * Flipcheck v2 — DOM Runner helper
 *
 * Extends vm-runner by pairing a real JSDOM document with the plain vm
 * sandbox.  Views are loaded into the vm context (with all peer stubs),
 * but tests create containers from a real JSDOM document — so calling
 * `container.innerHTML = ...` inside a view actually parses HTML, and
 * `container.querySelector(...)` returns real DOM elements.
 *
 * No @jest-environment jsdom docblock needed; tests run in the default
 * "node" environment and create their own JSDOM instances via this helper.
 *
 * Usage:
 *   const { loadViewInDom } = require("../helpers/dom-runner.js");
 *   let ctx, document;
 *   beforeAll(() => {
 *     ({ ctx, document } = loadViewInDom(["assets/lib/constants.js", ...]));
 *   });
 *   test("...", async () => {
 *     const container = document.createElement("div");
 *     await ctx.AlertsView.mount(container);
 *     expect(container.querySelector("#alertsList")).not.toBeNull();
 *   });
 */

"use strict";

const { JSDOM }      = require("jsdom");
const { loadScripts } = require("./vm-runner.js");

/**
 * Load view scripts into a vm context and return a real JSDOM document
 * for creating container elements that views can mount into.
 *
 * @param {string[]}           files  - Paths relative to the project root.
 * @param {Record<string, *>} [extras] - Extra sandbox overrides forwarded to loadScripts.
 * @returns {{ ctx: import("vm").Context, document: Document }}
 */
function loadViewInDom(files, extras = {}) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  const ctx = loadScripts(files, extras);
  return { ctx, document: dom.window.document };
}

module.exports = { loadViewInDom };
