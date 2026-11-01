import { describe, expect, test } from "bun:test";
import worker, { attention, card, handle, item } from "./attention";

const post = (body: unknown) => worker.fetch(new Request("https://x/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("attention spike server", () => {
  test("initialize echoes the client's protocol version", () => {
    const r = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }) as any;
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.capabilities).toEqual({ tools: {}, resources: {} });
  });
  test("notifications get 202 and no body", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });
  test("tools/list names the card resource on attention_next and hides attention_answer from the model", () => {
    const r = handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }) as any;
    const next = r.result.tools.find((t: any) => t.name === "attention_next");
    expect(next._meta.ui.resourceUri).toBe(attention.cardUri);
    const answer = r.result.tools.find((t: any) => t.name === "attention_answer");
    expect(answer._meta.ui.visibility).toEqual(["app"]);
  });
  test("resources/read serves the card as an MCP App", () => {
    const r = handle({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: attention.cardUri } }) as any;
    expect(r.result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(r.result.contents[0].text).toBe(card());
    expect(card()).toContain("ui/initialize");
    expect(card()).toContain("ui/notifications/tool-result");
  });
  test("attention_next returns the item as structuredContent and text fallback", () => {
    const r = handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "attention_next", arguments: {} } }) as any;
    expect(r.result.structuredContent.item).toEqual(item);
    expect(r.result.content[0].text).toContain(item.ask);
  });
  test("attention_answer records what the card sent", () => {
    const r = handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "attention_answer", arguments: { id: "spike-1", answer: "Yes, it renders" } } }) as any;
    expect(r.result.structuredContent.answer).toBe("Yes, it renders");
  });
  test("unknown method is -32601; GET is 405; other paths 404", async () => {
    const r = handle({ jsonrpc: "2.0", id: 6, method: "nope" }) as any;
    expect(r.error.code).toBe(-32601);
    expect((await worker.fetch(new Request("https://x/mcp"))).status).toBe(405);
    expect((await worker.fetch(new Request("https://x/"))).status).toBe(404);
  });
});
