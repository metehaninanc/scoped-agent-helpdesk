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
  .status { font-family: monospace; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }
  nav { margin-bottom: 1.5rem; }
  nav a { margin-right: 1rem; }
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
<nav><a href="/">Request</a><a href="/approvals">Approvals</a></nav>
${body}
</body>
</html>`;
}
