type AnyRecord = Record<string, any>;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RetellListOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  limit?: number;
}

interface RetellListPage {
  items?: AnyRecord[];
  has_more?: boolean;
  pagination_key?: string;
}

function normalizedBaseUrl(baseUrl = process.env.RETELL_BASE_URL || "https://api.retellai.com") {
  return baseUrl.replace(/\/$/, "");
}

async function parseRetellListPage(response: Response, endpoint: string): Promise<RetellListPage> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Retell ${endpoint} failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }
  const payload = (await response.json()) as RetellListPage;
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    has_more: payload.has_more === true,
    pagination_key: typeof payload.pagination_key === "string" ? payload.pagination_key : undefined,
  };
}

export async function listRetellVoiceAgentsV2(options: RetellListOptions): Promise<AnyRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const items: AnyRecord[] = [];
  let paginationKey: string | undefined;

  do {
    const body: AnyRecord = {
      limit: options.limit ?? 1000,
      filter_criteria: { channel: "voice" },
    };
    if (paginationKey) body.pagination_key = paginationKey;
    const response = await fetchImpl(`${normalizedBaseUrl(options.baseUrl)}/v2/list-agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const page = await parseRetellListPage(response, "POST /v2/list-agents");
    items.push(...(page.items ?? []));
    paginationKey = page.has_more ? page.pagination_key : undefined;
  } while (paginationKey);

  return items;
}

export async function listRetellPhoneNumbersV2(options: RetellListOptions): Promise<AnyRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const items: AnyRecord[] = [];
  let paginationKey: string | undefined;

  do {
    const url = new URL(`${normalizedBaseUrl(options.baseUrl)}/v2/list-phone-numbers`);
    url.searchParams.set("limit", String(options.limit ?? 1000));
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    const page = await parseRetellListPage(response, "GET /v2/list-phone-numbers");
    items.push(...(page.items ?? []));
    paginationKey = page.has_more ? page.pagination_key : undefined;
  } while (paginationKey);

  return items;
}
