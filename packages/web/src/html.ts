/**
 * Tiny HTML helpers. No template engine, no framework — SPRINT1.md, Component 6: "no SPA
 * framework, no build pipeline for the UI." Every value that came from a user, an agent, or a
 * model (identity fields, request text, group ids, decision notes, the generated rationale)
 * must go through escapeHtml() before it reaches a template. Nothing in this file trusts its
 * input.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

/** Elapsed time, not a timestamp — "age is the thing that hurts" (SPRINT4.md, section 3), the
 * same reasoning the dashboard's own "oldest pending" already used before the operator console
 * existed to share it with (SPRINT3.md, 3.5). Shared here rather than duplicated per page, unlike
 * db.ts's deliberate cross-package copy: this is a pure formatting function with no security
 * boundary to keep separate, so there is no reason for two copies to risk drifting apart. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (parts.length === 0 || minutes > 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

/** Escaped, then wrapped in <pre> so JSON facts render legibly without a JS syntax highlighter. */
export function escapedPre(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `<pre>${escapeHtml(text)}</pre>`;
}

const STYLE = `
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input[type=text], textarea { width: 100%; padding: 0.5rem; font: inherit; box-sizing: border-box; }
  textarea { min-height: 4rem; }
  button { margin-top: 1rem; padding: 0.5rem 1.2rem; font: inherit; cursor: pointer; }
  pre { background: #f4f4f4; padding: 0.75rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  .rationale { border: 1px solid #d0d0d0; padding: 0.75rem; background: #fafafa; }
  .rationale-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 0.4rem; }
  .rationale-missing { font-style: italic; color: #555; }
  .error { color: #a40000; border: 1px solid #a40000; padding: 0.5rem 0.75rem; background: #fff4f4; }
  .ok { color: #175c17; border: 1px solid #175c17; padding: 0.5rem 0.75rem; background: #f3fff3; }
  .info { color: #444; border: 1px solid #999; padding: 0.5rem 0.75rem; background: #f4f4f4; }
  .note { font-style: italic; color: #666; font-size: 0.9rem; margin-top: 0.5rem; }
  .status { font-family: monospace; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; overflow-wrap: break-word; }
  summary { cursor: pointer; }
  /* The trail table (console-page.ts, "what the system did and why"): auto layout sizes a column
     by its content's preferred width before wrapping is ever considered, so an unbroken value in
     one cell (a long JSON preview) can still push the whole table past the page's own max-width
     even with overflow-wrap set. Fixed column shares sidestep that: every column gets a bounded
     percentage of the table's own width regardless of content, and wrapping then applies within
     that bound rather than fighting it. */
  .trail { table-layout: fixed; font-size: 0.85rem; }
  .trail th:nth-child(1), .trail td:nth-child(1) { width: 13%; }
  .trail th:nth-child(2), .trail td:nth-child(2) { width: 17%; }
  .trail th:nth-child(3), .trail td:nth-child(3) { width: 18%; }
  .trail th:nth-child(4), .trail td:nth-child(4) { width: 22%; }
  .trail th:nth-child(5), .trail td:nth-child(5) { width: 12%; }
  .trail th:nth-child(6), .trail td:nth-child(6) { width: 18%; }
  nav { margin-bottom: 1.5rem; }
  nav a { margin-right: 1rem; }
  /* Operator console (SPRINT4.md, section 3): age is the number an operator acts on, so it is
     the one figure on this page set in monospace and given its own column — everything else
     here is prose. The single oldest row in each queue reads as urgent by weight and a warm,
     not alarming, tone — never the same red this page already reserves for an actual error. */
  .age { font-family: monospace; white-space: nowrap; }
  .age.oldest { font-weight: 700; color: #8a5a00; }
  .age.urgent { font-weight: 700; color: #a00000; }
  .urgent-badge { font-weight: 700; color: #fff; background: #a00000; padding: 0 0.35em; border-radius: 3px; font-size: 0.8em; }
  .queue-empty { color: #175c17; }
`;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<nav><a href="/">Request</a><a href="/console">Console</a><a href="/dashboard">Dashboard</a></nav>
${body}
</body>
</html>`;
}
