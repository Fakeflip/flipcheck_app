// @ts-check
/* Flipcheck v2 — Modal System */

const Modal = (() => {
  /** @type {HTMLElement|null} */ let overlay  = null;
  /** @type {HTMLElement|null} */ let box      = null;
  /** @type {HTMLElement|null} */ let titleEl  = null;
  /** @type {HTMLElement|null} */ let bodyEl   = null;
  /** @type {HTMLElement|null} */ let footerEl = null;
  /** @type {HTMLElement|null} */ let closeBtn = null;
  /** @type {((value: *) => void)|null} */ let resolvePromise = null;

  /** Wire up DOM references and global event listeners (idempotent). */
  function init() {
    overlay  = document.getElementById("modal-overlay");
    box      = document.getElementById("modal-box");
    titleEl  = document.getElementById("modal-title");
    bodyEl   = document.getElementById("modal-body");
    footerEl = document.getElementById("modal-footer");
    closeBtn = document.getElementById("modal-close");

    closeBtn?.addEventListener("click", () => close(null));
    overlay?.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay?.style.display !== "none") close(null);
    });
  }

  /**
   * Open the modal and return a Promise that resolves when the user dismisses it.
   * @param {FC_ModalOptions} options
   * @returns {Promise<*>} Resolves with the clicked button's `value`, or `null` on Esc / close.
   */
  function open({ title, body, buttons = [], width }) {
    if (!overlay) init();

    if (titleEl) titleEl.textContent = title || "";
    if (bodyEl) {
      bodyEl.innerHTML = typeof body === "string" ? body : "";
      if (body instanceof HTMLElement) { bodyEl.innerHTML = ""; bodyEl.appendChild(body); }
    }

    if (footerEl) {
      footerEl.innerHTML = "";
      if (buttons.length) {
        buttons.forEach(({ label, variant = "btn-secondary", value, action }) => {
          const btn = document.createElement("button");
          btn.className = `btn ${variant}`;
          btn.textContent = label;
          btn.addEventListener("click", () => {
            if (action) action();
            else close(value ?? label);
          });
          footerEl?.appendChild(btn);
        });
      }
    }

    if (box) {
      if (width) box.style.width = typeof width === "number" ? `${width}px` : width;
      else box.style.width = "";

      // Re-trigger animation
      box.style.animation = "none";
      requestAnimationFrame(() => { if (box) box.style.animation = ""; });
    }

    if (overlay) overlay.style.display = "flex";

    return new Promise(resolve => { resolvePromise = resolve; });
  }

  /**
   * Close the modal and resolve the open() Promise.
   * @param {*} value - Value forwarded to the awaiting caller.
   */
  function close(value) {
    if (!overlay) return;
    overlay.style.display = "none";
    if (resolvePromise) { resolvePromise(value); resolvePromise = null; }
  }

  /**
   * Show a confirm dialog with Cancel / Confirm buttons.
   * @param {string}  title
   * @param {string}  message
   * @param {{ confirmLabel?: string, danger?: boolean }} [opts]
   * @returns {Promise<boolean>} Resolves `true` on confirm, `false` on cancel.
   */
  function confirm(title, message, { confirmLabel = "Bestätigen", danger = false } = {}) {
    return open({
      title,
      body: `<p class="modal-msg">${esc(message)}</p>`,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost",    value: false },
        { label: confirmLabel, variant: danger ? "btn-danger" : "btn-primary", value: true },
      ],
    });
  }

  /**
   * Show a simple alert dialog with a single OK button.
   * @param {string} title
   * @param {string} message
   * @returns {Promise<true>}
   */
  function alert(title, message) {
    return open({
      title,
      body: `<p class="modal-msg">${esc(message)}</p>`,
      buttons: [{ label: "OK", variant: "btn-primary", value: true }],
    });
  }

  /**
   * HTML-escape a value for safe insertion into innerHTML.
   * @param {*} str
   * @returns {string}
   */
  function esc(str) {
    return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { open, close, confirm, alert, init };
})();
