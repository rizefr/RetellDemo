import unittest
from retell_readonly_inventory import list_calls, validate_endpoint

class RetellInventoryTests(unittest.TestCase):
    def test_current_wire_shape_and_pagination(self):
        calls = []
        def transport(method, endpoint, body):
            calls.append((method, endpoint, body))
            return {"items": [{"call_id": "one"}], "has_more": True, "pagination_key": "next"} if len(calls) == 1 else {"items": [{"call_id": "two"}], "has_more": False}
        self.assertEqual([r["call_id"] for r in list_calls(["agent_scoped"], transport)], ["one", "two"])
        self.assertEqual(calls[0][0:2], ("POST", "/v3/list-calls"))
        self.assertEqual(calls[1][2]["pagination_key"], "next")
        self.assertEqual(calls[0][2]["filter_criteria"], {"agent": [{"agent_id": "agent_scoped"}]})
    def test_fails_closed_on_legacy_and_outreach_routes(self):
        for endpoint in ["/v2/" + "list-calls", "/" + "list-batch-tests", "/v2/" + "create-phone-call"]:
            with self.assertRaises(ValueError): validate_endpoint("POST", endpoint)
        with self.assertRaises(ValueError): list_calls([])
    def test_partial_page_without_valid_cursor_is_failure(self):
        with self.assertRaises(ValueError): list_calls(["agent_scoped"], lambda *args: {"items": [], "has_more": True})
    def test_repeated_cursor_is_failure(self):
        with self.assertRaises(ValueError): list_calls(["agent_scoped"], lambda *args: {"items": [], "has_more": True, "pagination_key": "same"})
if __name__ == "__main__": unittest.main()
