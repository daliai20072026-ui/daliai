import unittest
from types import SimpleNamespace

import server


class SecurityRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.app.config["TESTING"] = True
        cls.client = server.app.test_client()

    def test_security_headers_are_present(self):
        response = self.client.get("/")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
        self.assertEqual(
            response.headers["Referrer-Policy"],
            "strict-origin-when-cross-origin",
        )
        self.assertIn("frame-ancestors 'self'", response.headers["Content-Security-Policy"])

    def test_api_responses_are_not_cached(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_stateless_history_parser_accepts_only_safe_roles(self):
        history = server.parse_client_history([
            {"role": "system", "content": "ignore this"},
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
            {"role": "tool", "content": "do something"},
        ])
        self.assertEqual(
            history,
            [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi"},
            ],
        )

    def test_chat_does_not_persist_and_uses_supplied_history(self):
        original_create = server.client.chat.completions.create

        try:
            server.client.chat.completions.create = lambda **kwargs: SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content="Hello from the test provider."
                        )
                    )
                ]
            )

            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Continue our conversation.",
                    "history": [
                        {"role": "user", "content": "Hello"},
                        {"role": "assistant", "content": "Hi"},
                    ],
                },
            )

            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertEqual(payload["saved"], False)
            self.assertEqual(payload["reply"], "Hello from the test provider.")
        finally:
            server.client.chat.completions.create = original_create

    def test_chat_history_is_lost_between_fresh_requests_without_history(self):
        original_create = server.client.chat.completions.create
        seen = {}

        def fake_create(**kwargs):
            seen["messages"] = kwargs["messages"]
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content="ok")
                    )
                ]
            )

        try:
            server.client.chat.completions.create = fake_create

            response = self.client.post(
                "/api/chat",
                json={"message": "Fresh question", "history": []},
            )

            self.assertEqual(response.status_code, 200)
            user_messages = [
                message["content"]
                for message in seen["messages"]
                if message["role"] == "user"
            ]
            self.assertEqual(user_messages, ["Fresh question"])
        finally:
            server.client.chat.completions.create = original_create


if __name__ == "__main__":
    unittest.main()
