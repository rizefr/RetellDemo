"""Read-only Retell diagnostics using supported pagination; never creates calls or sends."""
import json
import os
import urllib.parse
import urllib.request

API_BASE = "https://api.retellai.com"
ALLOWED_LISTS = {
    ("POST", "/v3/list-calls"),
    ("GET", "/v2/list-batch-tests"),
    ("GET", "/v2/list-test-case-definitions"),
    ("GET", "/v2/list-phone-numbers"),
    ("POST", "/v2/list-agents"),
    ("GET", "/v2/list-conversation-flows"),
    ("GET", "/v2/list-retell-llms"),
}

def validate_endpoint(method, path):
    route = urllib.parse.urlsplit(path)
    if route.scheme or route.netloc:
        raise ValueError("Diagnostics require the fixed Retell API host")
    if (method, route.path) in ALLOWED_LISTS:
        return
    if method == "GET" and route.path.startswith("/v2/list-test-runs/"):
        return
    raise ValueError("Unsupported or non-read-only Retell diagnostic endpoint")

def request_json(method, path, body=None):
    validate_endpoint(method, path)
    key = os.environ["RETELL_API_KEY"]
    req = urllib.request.Request(API_BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

def list_calls(agent_ids, transport=request_json):
    if not agent_ids or any(not str(value).startswith("agent_") for value in agent_ids):
        raise ValueError("Explicit verified agent IDs are required")
    result, seen, cursor = [], set(), None
    while True:
        body = {"filter_criteria": {"agent": [{"agent_id": value} for value in agent_ids]},
                "limit": 100, "sort_order": "descending"}
        if cursor:
            body["pagination_key"] = cursor
        page = transport("POST", "/v3/list-calls", body)
        if not isinstance(page.get("items"), list) or not isinstance(page.get("has_more"), bool):
            raise ValueError("Invalid current Retell pagination response")
        result.extend(page["items"])
        if not page["has_more"]:
            return result
        cursor = page.get("pagination_key")
        if not isinstance(cursor, str) or not cursor or cursor in seen:
            raise ValueError("Missing or repeated Retell pagination cursor")
        seen.add(cursor)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent-id", action="append", required=True)
    args = parser.parse_args()
    calls = list_calls(args.agent_id)
    print(json.dumps({"endpoint": "POST /v3/list-calls", "count": len(calls),
                      "with_transcript": sum(bool(item.get("transcript")) for item in calls),
                      "with_recording": sum(bool(item.get("recording_url")) for item in calls)}))
