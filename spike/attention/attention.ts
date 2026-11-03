// The attention-surface spike: an MCP Apps server as a Cloudflare Worker
// (declared in alchemy.run.ts), serving one hard-coded item as an
// interactive card, to find out whether Claude's project app renders MCP
// Apps. No store, no auth, no secrets: everything it says is in this file.
// Design thread: "Design the attention surface for me and agents"
// (project Pi Durable, 2026-10-29..11-01). Wire format: MCP Apps
// specification 2026-01-26 (github.com/modelcontextprotocol/ext-apps).

export const attention = {
  name: "systems-attention",
  cardUri: "ui://systems-attention/card",
  protocolVersion: "2025-06-18",
} as const;

// One item in the shape the design set: what is asked, why only George,
// what happens if ignored, a link back to the source. Hard-coded until the
// queue (Beads, label `human`) is behind this server.
export const item = {
  id: "spike-1",
  ask: "Does this card render in the project app?",
  why: "Only you can see the app; the agent cannot.",
  ifIgnored: "The attention-surface design stays unverified and we build on cards in chat instead.",
  options: ["Yes, it renders", "No, I see text only"],
  source: "https://claude.ai/code/project/chan_01NeiW5NvF3iw4xqbyzm5iaL",
} as const;

type Json = Record<string, unknown>;
type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: Json };

const tools = [
  {
    name: "attention_next",
    description: "The next item that needs George's attention, as a card he can answer in place.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    _meta: { ui: { resourceUri: attention.cardUri, visibility: ["model", "app"] } },
  },
  {
    name: "attention_answer",
    description: "Record George's answer to an item. Called by the card.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, answer: { type: "string" } },
      required: ["id", "answer"],
      additionalProperties: false,
    },
    _meta: { ui: { visibility: ["app"] } },
  },
];

export function card(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; font: 15px/1.45 system-ui, sans-serif; }
  body { margin: 0; padding: 12px 16px; }
  .ask { font-weight: 600; font-size: 17px; margin: 0 0 6px; }
  .meta { margin: 0 0 4px; opacity: .8; }
  .meta b { font-weight: 600; opacity: 1; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; }
  button:disabled { opacity: .5; }
  .done { margin-top: 10px; }
  a { color: inherit; }
</style></head><body>
<p class="ask" id="ask">Loading…</p>
<p class="meta" id="why"></p>
<p class="meta" id="ignored"></p>
<p class="meta"><a id="source" href="#" target="_blank" rel="noopener">source</a></p>
<div class="row" id="row"></div>
<p class="done" id="done" hidden></p>
<script>
(() => {
  let seq = 1;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
  const notify = (method, params) => window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  let item = null;
  const $ = id => document.getElementById(id);
  const render = () => {
    if (!item) return;
    $("ask").textContent = item.ask;
    $("why").innerHTML = "<b>Why you:</b> " + esc(item.why);
    $("ignored").innerHTML = "<b>If ignored:</b> " + esc(item.ifIgnored);
    $("source").href = item.source;
    const row = $("row"); row.innerHTML = "";
    for (const o of item.options) {
      const b = document.createElement("button");
      b.textContent = o;
      b.onclick = () => answer(o);
      row.appendChild(b);
    }
  };
  const esc = s => String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  const answer = async (choice) => {
    for (const b of document.querySelectorAll("button")) b.disabled = true;
    try {
      await send("tools/call", { name: "attention_answer", arguments: { id: item.id, answer: choice } });
      $("done").hidden = false; $("done").textContent = "Recorded: " + choice;
      // ui/message is a request the host answers (it may ask the user first).
      await send("ui/message", { role: "user", content: [{ type: "text", text: "Answered \\"" + item.ask + "\\": " + choice }] }).catch(() => {});
    } catch (e) {
      $("done").hidden = false; $("done").textContent = "Could not record: " + (e && e.message || e);
      for (const b of document.querySelectorAll("button")) b.disabled = false;
    }
  };
  window.addEventListener("message", ev => {
    const m = ev.data; if (!m || m.jsonrpc !== "2.0") return;
    // A request from the host (ping, ui/resource-teardown): answer it.
    if (m.method && m.id !== undefined) {
      window.parent.postMessage({ jsonrpc: "2.0", id: m.id, result: {} }, "*");
      return;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message || "error")) : p.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") {
      item = m.params && m.params.structuredContent && m.params.structuredContent.item || item;
      render();
      queueSize();
    }
  });
  // The host shows the view only once it has a size, so report it after
  // the handshake and whenever the content changes, as the ext-apps App
  // class does with autoResize.
  let lastW = 0, lastH = 0, queued = false;
  const reportSize = () => {
    queued = false;
    const width = Math.ceil(window.innerWidth);
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (width === lastW && height === lastH) return;
    lastW = width; lastH = height;
    notify("ui/notifications/size-changed", { width, height });
  };
  const queueSize = () => { if (!queued) { queued = true; requestAnimationFrame(reportSize); } };
  const info = { name: "systems-attention card", version: "0.1.2" };
  send("ui/initialize", {
    protocolVersion: "2026-01-26",
    appCapabilities: { availableDisplayModes: ["inline"] },
    appInfo: info,
  }).then(() => {
    notify("ui/notifications/initialized");
    reportSize();
    new ResizeObserver(queueSize).observe(document.documentElement);
  }).catch(e => { $("ask").textContent = "Handshake failed: " + (e && e.message || e); });
})();
</script></body></html>`;
}

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

export function handle(msg: Rpc): unknown | null {
  const { id, method, params = {} } = msg;
  if (!method) return fail(id ?? null, -32600, "invalid request");
  // Notifications get no body.
  if (id === undefined) return null;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : attention.protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: attention.name, version: "0.1.0" },
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools });
    case "prompts/list":
      return ok(id, { prompts: [] });
    case "resources/list":
      return ok(id, { resources: [{ uri: attention.cardUri, name: "Attention card", mimeType: "text/html;profile=mcp-app" }] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "resources/read": {
      if (params.uri !== attention.cardUri) return fail(id, -32002, `unknown resource ${String(params.uri)}`);
      return ok(id, { contents: [{ uri: attention.cardUri, mimeType: "text/html;profile=mcp-app", text: card(), _meta: { ui: { prefersBorder: true } } }] });
    }
    case "tools/call": {
      const name = params.name;
      const args = (params.arguments ?? {}) as Json;
      if (name === "attention_next") {
        return ok(id, {
          content: [{ type: "text", text: `Needs George: ${item.ask} (${item.options.join(" / ")})` }],
          structuredContent: { item },
        });
      }
      if (name === "attention_answer") {
        const text = `Recorded answer to ${String(args.id)}: ${String(args.answer)}`;
        return ok(id, { content: [{ type: "text", text }], structuredContent: { id: args.id, answer: args.answer, recordedAt: new Date().toISOString() } });
      }
      return fail(id, -32602, `unknown tool ${String(name)}`);
    }
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/mcp") return new Response("systems-attention: MCP at /mcp\n", { status: 404 });
    if (request.method === "GET") return new Response("no server stream\n", { status: 405, headers: { Allow: "POST" } });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.method !== "POST") return new Response("method not allowed\n", { status: 405, headers: { Allow: "POST" } });
    let body: unknown;
    try { body = await request.json(); } catch { return new Response(JSON.stringify(fail(null, -32700, "parse error")), { status: 400, headers: { "Content-Type": "application/json" } }); }
    const messages = Array.isArray(body) ? body as Rpc[] : [body as Rpc];
    const replies = messages.map(handle).filter(r => r !== null);
    if (replies.length === 0) return new Response(null, { status: 202 });
    const out = Array.isArray(body) ? replies : replies[0];
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  },
};
