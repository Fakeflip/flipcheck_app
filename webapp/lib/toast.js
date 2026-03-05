// @ts-check
/* Flipcheck Web App — Toast System */

const Toast = (() => {
  const ICONS = {
    success: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#10B981" stroke-width="1.5"/><path d="M5 8l2.5 2.5L11 5.5" stroke="#10B981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    error:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#EF4444" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    warning: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13H1.5L8 2z" stroke="#F59E0B" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="#F59E0B"/></svg>`,
    info:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#6366F1" stroke-width="1.5"/><path d="M8 7v5" stroke="#6366F1" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="5" r="0.75" fill="#6366F1"/></svg>`,
  };
  const CLOSE_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  function esc(str) {
    return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function show(type, title, message, duration = 4000) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-icon">${ICONS[type] || ICONS.info}</div>
      <div class="toast-body">
        <div class="toast-title">${esc(title)}</div>
        ${message ? `<div class="toast-msg">${esc(message)}</div>` : ""}
      </div>
      <button class="toast-close" aria-label="Schließen">${CLOSE_ICON}</button>
    `;
    container.appendChild(el);
    el.querySelector(".toast-close")?.addEventListener("click", () => dismiss(el));
    if (duration > 0) setTimeout(() => dismiss(el), duration);
    return el;
  }

  function dismiss(el) {
    if (!el || el.classList.contains("exit")) return;
    el.classList.add("exit");
    setTimeout(() => el.remove(), 200);
  }

  return {
    success: (title, msg, dur) => show("success", title, msg, dur),
    error:   (title, msg, dur) => show("error",   title, msg, dur),
    warning: (title, msg, dur) => show("warning", title, msg, dur),
    warn:    (title, msg, dur) => show("warning", title, msg, dur),
    info:    (title, msg, dur) => show("info",    title, msg, dur),
  };
})();
