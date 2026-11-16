// Every length is in rem: the preload scales the root font size with the window width.
export const USAGE_WIDGET_DOCUMENT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T3 Code: Usage limits</title>
<style>
:root {
  color-scheme: light dark;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  --bg: #fafafa; --fg: #1c1c1c; --muted: #5f5f5f; --line: #e0e0e0; --track: #e4e4e4; --hover: #eee;
  --focus: #2f6fdd; --warn: #a53f1c; --ok: #1d6a43; --chart: var(--fg);
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #181818; --fg: #f1f1f1; --muted: #a9a9a9; --line: #343434; --track: #333; --hover: #2a2a2a;
    --focus: #7aa7ff; --warn: #f0a174; --ok: #86c9a0; }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--fg); overflow: hidden; }
header { display: flex; align-items: center; gap: 0.25rem; padding: 0.5rem 0.625rem; border-bottom: 1px solid var(--line); -webkit-app-region: drag; user-select: none; }
header strong { flex: 1; min-width: 0; font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button { -webkit-app-region: no-drag; display: grid; place-items: center; width: 1.875rem; height: 1.875rem; padding: 0; background: transparent; color: var(--muted); border: 0; border-radius: 0.375rem; cursor: pointer; }
button:hover { background: var(--hover); color: var(--fg); }
button[aria-pressed="true"] { color: var(--fg); background: var(--hover); }
button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
button svg { width: 1.0625rem; height: 1.0625rem; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
main { flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--muted) transparent; }
#groups { display: flex; flex-direction: column; }
body[data-layout="horizontal"] #groups { flex-direction: row; }
section { flex: 1 1 0; min-width: 0; padding: 0.875rem 0.875rem 1rem; border-bottom: 1px solid var(--line); }
body[data-layout="horizontal"] section { border-bottom: 0; border-right: 1px solid var(--line); }
section:last-child { border-color: transparent; }
h2 { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.75rem; font-size: 0.9rem; font-weight: 650; }
h2 i { flex: none; width: 0.625rem; height: 0.625rem; border-radius: 50%; background: var(--chart); }
h2 span { margin-left: auto; padding: 0.0625rem 0.5rem; border-radius: 999px; background: var(--hover); color: var(--muted); font-size: 0.72rem; font-weight: 500; white-space: nowrap; }
h2 span[data-offline="true"] { color: var(--warn); box-shadow: inset 0 0 0 1px currentColor; background: transparent; }
.window + .window { margin-top: 1.125rem; }
.head { display: flex; align-items: baseline; gap: 0.5rem; }
.head .name { flex: 1; min-width: 0; color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
.pct { font-size: 1.75rem; line-height: 1; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.pct small { margin-left: 0.25rem; color: var(--muted); font-size: 0.75rem; font-weight: 500; letter-spacing: 0; }
.pct[data-low="true"] { color: var(--warn); }
.bar { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 0.25rem; margin: 0.5rem 0 0.4rem; }
.seg { position: relative; height: 0.875rem; border-radius: 0.3125rem; background: var(--track); }
.fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--chart); }
.seg[data-empty="true"] { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
.line { position: absolute; top: -0.25rem; bottom: -0.25rem; width: 0.1875rem; margin-left: -0.09375rem; border-radius: 999px; background: var(--fg); box-shadow: 0 0 0 0.1875rem var(--bg); }
.foot { display: flex; gap: 0.5rem; justify-content: space-between; color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.foot b { font-weight: 600; white-space: nowrap; }
.foot b[data-pace="ahead"] { color: var(--warn); }
.foot b[data-pace="under"] { color: var(--ok); }
#legend { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.875rem 0.75rem; color: var(--muted); font-size: 0.72rem; }
#legend i { position: relative; width: 1.5rem; height: 0.4rem; border-radius: 0.2rem; background: var(--track); }
#legend i::after { content: ""; position: absolute; top: -0.2rem; bottom: -0.2rem; left: 50%; width: 0.1875rem; margin-left: -0.09375rem; border-radius: 999px; background: var(--fg); box-shadow: 0 0 0 0.125rem var(--bg); }
#legend[hidden], #empty[hidden] { display: none; }
#notices { padding: 0 0.875rem 0.75rem; color: var(--muted); font-size: 0.75rem; white-space: pre-line; overflow-wrap: anywhere; }
#notices:empty { display: none; }
#empty { margin: 0; padding: 1rem 0.875rem; color: var(--muted); }
::selection { background: var(--focus); color: var(--bg); }
@media (prefers-reduced-motion: no-preference) { .fill { transition: width 0.2s ease-out; } }
</style></head><body data-layout="vertical">
<header id="drag"><strong>Usage limits</strong>
<button id="pin" title="Keep above other windows" aria-label="Keep above other windows" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v6"/></svg></button>
<button id="layout" title="Switch to horizontal layout" aria-label="Switch to horizontal layout"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg></button>
<button id="open" title="Open T3 Code" aria-label="Open T3 Code"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg></button>
<button id="hide" title="Hide widget" aria-label="Hide widget"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
</header><main aria-label="Provider usage limits"><div id="content"><div id="groups"></div><p id="empty">Waiting for T3 Code...</p>
<div id="legend" hidden><i aria-hidden="true"></i>Line: where even spending would be</div><div id="notices" role="status"></div></div></main>
</body></html>`;
