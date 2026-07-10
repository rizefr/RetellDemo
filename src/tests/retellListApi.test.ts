import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listRetellPhoneNumbersV2, listRetellVoiceAgentsV2 } from "../retell/retellList";

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return entry.isFile() && /\.(ts|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

describe("Retell versioned list APIs", () => {
  it("lists voice agents with POST /v2/list-agents, filter criteria, items, and pagination_key", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () =>
          requests.length === 1
            ? { items: [{ agent_id: "agent_1" }], has_more: true, pagination_key: "agent_1" }
            : { items: [{ agent_id: "agent_2" }], has_more: false },
      } as Response;
    };

    const agents = await listRetellVoiceAgentsV2({
      apiKey: "test-key",
      baseUrl: "https://api.retellai.test",
      fetchImpl,
      limit: 1,
    });

    expect(agents.map((agent) => agent.agent_id)).toEqual(["agent_1", "agent_2"]);
    expect(requests.map((request) => [request.init.method, request.url])).toEqual([
      ["POST", "https://api.retellai.test/v2/list-agents"],
      ["POST", "https://api.retellai.test/v2/list-agents"],
    ]);
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      limit: 1,
      filter_criteria: { channel: { type: "string", op: "eq", value: "voice" } },
    });
    expect(JSON.parse(String(requests[1].init.body))).toEqual({
      limit: 1,
      filter_criteria: { channel: { type: "string", op: "eq", value: "voice" } },
      pagination_key: "agent_1",
    });
    expect(String(requests[0].init.body)).not.toContain("pagination_key_version");
  });

  it("lists phone numbers with GET /v2/list-phone-numbers and items pagination", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () =>
          requests.length === 1
            ? { items: [{ phone_number: "+15550000001" }], has_more: true, pagination_key: "pn_1" }
            : { items: [{ phone_number: "+15550000002" }], has_more: false },
      } as Response;
    };

    const phones = await listRetellPhoneNumbersV2({
      apiKey: "test-key",
      baseUrl: "https://api.retellai.test",
      fetchImpl,
      limit: 1,
    });

    expect(phones.map((phone) => phone.phone_number)).toEqual(["+15550000001", "+15550000002"]);
    expect(requests.map((request) => [request.init.method, request.url])).toEqual([
      ["GET", "https://api.retellai.test/v2/list-phone-numbers?limit=1"],
      ["GET", "https://api.retellai.test/v2/list-phone-numbers?limit=1&pagination_key=pn_1"],
    ]);
  });

  it("keeps deprecated Retell list endpoints out of source code", () => {
    const source = collectSourceFiles(path.resolve(process.cwd(), "src"))
      .filter((file) => !file.endsWith(path.join("src", "tests", "retellListApi.test.ts")))
      .map((file) => [file, fs.readFileSync(file, "utf8")] as const);

    for (const [file, contents] of source) {
      expect(contents, file).not.toMatch(/client\.agent\.list\s*\(/);
      expect(contents, file).not.toMatch(/client\.phoneNumber\.list\s*\(/);
      expect(contents, file).not.toMatch(/(?<!\/v2)\/list-agents/);
      expect(contents, file).not.toMatch(/(?<!\/v2)\/list-phone-numbers/);
      expect(contents, file).not.toContain("pagination_key_version");
    }
  });
});
