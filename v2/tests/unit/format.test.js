/**
 * Flipcheck v2 — Tests: esc, fmtEur, fmtPct, fmtDate, fmtDays, friendlyError
 * Covers: assets/app.js (loaded via vm-runner)
 */

"use strict";

const { loadScripts } = require("../helpers/vm-runner.js");

/** Shared vm context — load once for all tests in this file. */
let ctx;

beforeAll(() => {
  ctx = loadScripts(["assets/app.js"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// esc()
// ─────────────────────────────────────────────────────────────────────────────

describe("esc()", () => {
  test("escapes & → &amp;", () => {
    expect(ctx.esc("a & b")).toBe("a &amp; b");
  });

  test("escapes < → &lt; (both angle brackets are escaped)", () => {
    // esc() escapes < and > — <script> becomes &lt;script&gt;
    expect(ctx.esc("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes > → &gt;", () => {
    expect(ctx.esc("a > b")).toBe("a &gt; b");
  });

  test("escapes multiple special chars in one string", () => {
    expect(ctx.esc("<b>Tom & Jerry</b>")).toBe("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
  });

  test("null → empty string", () => {
    expect(ctx.esc(null)).toBe("");
  });

  test("undefined → empty string", () => {
    expect(ctx.esc(undefined)).toBe("");
  });

  test("number is converted to string and returned", () => {
    expect(ctx.esc(42)).toBe("42");
  });

  test("safe string passes through unchanged", () => {
    expect(ctx.esc("Hello World")).toBe("Hello World");
  });

  test("empty string stays empty", () => {
    expect(ctx.esc("")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fmtEur()
// ─────────────────────────────────────────────────────────────────────────────

describe("fmtEur()", () => {
  test("null → '—'", () => {
    expect(ctx.fmtEur(null)).toBe("—");
  });

  test("undefined → '—'", () => {
    expect(ctx.fmtEur(undefined)).toBe("—");
  });

  test("NaN → '—'", () => {
    expect(ctx.fmtEur(NaN)).toBe("—");
  });

  test("0 → formats as zero euros (de-DE)", () => {
    // German locale: "0,00 €" or "0,00 €" depending on Node
    expect(ctx.fmtEur(0)).toContain("0,00");
    expect(ctx.fmtEur(0)).toContain("€");
  });

  test("positive number formats with German decimal comma", () => {
    const result = ctx.fmtEur(12.5);
    expect(result).toContain("12,50");
    expect(result).toContain("€");
  });

  test("large number has German thousands separator (dot)", () => {
    const result = ctx.fmtEur(1234.56);
    // de-DE: "1.234,56 €"
    expect(result).toContain("1.234");
    expect(result).toContain("56");
  });

  test("negative number formats with minus sign", () => {
    const result = ctx.fmtEur(-5.0);
    // de-DE may use ASCII hyphen '-' or Unicode minus '−' depending on Node version
    expect(result).toMatch(/[-−]/);
    expect(result).toContain("5,00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fmtPct()
// ─────────────────────────────────────────────────────────────────────────────

describe("fmtPct()", () => {
  test("null → '—'", () => {
    expect(ctx.fmtPct(null)).toBe("—");
  });

  test("undefined → '—'", () => {
    expect(ctx.fmtPct(undefined)).toBe("—");
  });

  test("NaN → '—'", () => {
    expect(ctx.fmtPct(NaN)).toBe("—");
  });

  test("Infinity → '—'", () => {
    expect(ctx.fmtPct(Infinity)).toBe("—");
  });

  test("-Infinity → '—'", () => {
    expect(ctx.fmtPct(-Infinity)).toBe("—");
  });

  test("positive value → '+X.X%'", () => {
    expect(ctx.fmtPct(12.5)).toBe("+12.5%");
  });

  test("negative value → '-X.X%'", () => {
    expect(ctx.fmtPct(-3.2)).toBe("-3.2%");
  });

  test("zero → '+0.0%'", () => {
    expect(ctx.fmtPct(0)).toBe("+0.0%");
  });

  test("rounds to one decimal place", () => {
    expect(ctx.fmtPct(12.345)).toBe("+12.3%");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fmtDate()
// ─────────────────────────────────────────────────────────────────────────────

describe("fmtDate()", () => {
  test("null → '—'", () => {
    expect(ctx.fmtDate(null)).toBe("—");
  });

  test("undefined → '—'", () => {
    expect(ctx.fmtDate(undefined)).toBe("—");
  });

  test("empty string → '—'", () => {
    expect(ctx.fmtDate("")).toBe("—");
  });

  test("ISO date '2025-03-04' → '04.03.25' (de-DE short)", () => {
    expect(ctx.fmtDate("2025-03-04")).toBe("04.03.25");
  });

  test("ISO datetime string is accepted", () => {
    const result = ctx.fmtDate("2025-01-15T10:00:00.000Z");
    expect(result).toMatch(/\d{2}\.\d{2}\.\d{2}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fmtDays()
// ─────────────────────────────────────────────────────────────────────────────

describe("fmtDays()", () => {
  test("null → '—'", () => {
    expect(ctx.fmtDays(null)).toBe("—");
  });

  test("undefined → '—'", () => {
    expect(ctx.fmtDays(undefined)).toBe("—");
  });

  test("NaN → '—'", () => {
    expect(ctx.fmtDays(NaN)).toBe("—");
  });

  test("14 → '14d'", () => {
    expect(ctx.fmtDays(14)).toBe("14d");
  });

  test("0 → '0d'", () => {
    expect(ctx.fmtDays(0)).toBe("0d");
  });

  test("7.8 rounds to '8d'", () => {
    expect(ctx.fmtDays(7.8)).toBe("8d");
  });

  test("1.4 rounds to '1d'", () => {
    expect(ctx.fmtDays(1.4)).toBe("1d");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// friendlyError()
// ─────────────────────────────────────────────────────────────────────────────

describe("friendlyError()", () => {
  test("network error → Verbindungsfehler", () => {
    const result = ctx.friendlyError(new Error("Failed to fetch"));
    expect(result.title).toBe("Verbindungsfehler");
  });

  test("'load failed' → Verbindungsfehler", () => {
    const result = ctx.friendlyError(new Error("Load failed"));
    expect(result.title).toBe("Verbindungsfehler");
  });

  test("401 in message → Sitzung abgelaufen", () => {
    const result = ctx.friendlyError(new Error("HTTP 401 Unauthorized"));
    expect(result.title).toBe("Sitzung abgelaufen");
  });

  test("token in message → Sitzung abgelaufen", () => {
    const result = ctx.friendlyError(new Error("invalid token"));
    expect(result.title).toBe("Sitzung abgelaufen");
  });

  test("403 in message → Keine Berechtigung", () => {
    const result = ctx.friendlyError(new Error("HTTP 403 Forbidden"));
    expect(result.title).toBe("Keine Berechtigung");
  });

  test("429 in message → Limit erreicht", () => {
    const result = ctx.friendlyError(new Error("429 rate limit exceeded"));
    expect(result.title).toBe("Limit erreicht");
  });

  test("500 in message → Serverfehler", () => {
    const result = ctx.friendlyError(new Error("500 internal server error"));
    expect(result.title).toBe("Serverfehler");
  });

  test("timeout → Zeitüberschreitung", () => {
    const result = ctx.friendlyError(new Error("Request timed out"));
    expect(result.title).toBe("Zeitüberschreitung");
  });

  test("unknown error → generic Fehler title", () => {
    const result = ctx.friendlyError(new Error("something weird happened"));
    expect(result.title).toBe("Fehler");
    expect(result.sub).toContain("something weird");
  });

  test("string argument → treated as error message", () => {
    const result = ctx.friendlyError("failed to fetch data");
    expect(result.title).toBe("Verbindungsfehler");
  });

  test("null argument → generic Fehler with fallback sub", () => {
    const result = ctx.friendlyError(null);
    expect(result.title).toBe("Fehler");
    expect(result.sub).toBeTruthy();
  });

  test("result always has { title, sub } shape", () => {
    const result = ctx.friendlyError(new Error("any error"));
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("sub");
    expect(typeof result.title).toBe("string");
    expect(typeof result.sub).toBe("string");
  });
});
