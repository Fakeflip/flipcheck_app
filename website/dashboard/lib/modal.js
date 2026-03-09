// @ts-check
/* Flipcheck Web App — Modal System */

const Modal = (() => {
  let overlay  = null;
  let box      = null;
  let titleEl  = null;
  let bodyEl   = null;
  let footerEl = null;
  let closeBtn = null;
  let resolvePromise = null;

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
      box.style.animation = "none";
      requestAnimationFrame(() => { if (box) box.style.animation = ""; });
    }
    if (overlay) overlay.style.display = "flex";
    return new Promise(resolve => { resolvePromise = resolve; });
  }

  function close(value) {
    if (!overlay) return;
    overlay.style.display = "none";
    if (resolvePromise) { resolvePromise(value); resolvePromise = null; }
  }

  function confirm(title, message, { confirmLabel = "Bestätigen", danger = false } = {}) {
    return open({
      title,
      body: `<p class="modal-msg">${esc(message)}</p>`,
      buttons: [
        { label: "Abbrechen",   variant: "btn-ghost",                          value: false },
        { label: confirmLabel,  variant: danger ? "btn-danger" : "btn-primary", value: true  },
      ],
    });
  }

  function alert(title, message) {
    return open({
      title,
      body: `<p class="modal-msg">${esc(message)}</p>`,
      buttons: [{ label: "OK", variant: "btn-primary", value: true }],
    });
  }

  function esc(str) {
    return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { open, close, confirm, alert, init };
})();
