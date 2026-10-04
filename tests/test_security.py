import os
import unittest

# Use an isolated in-memory database for the security regression tests.
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-only-secret-change-me"
os.environ.pop("VERCEL", None)

from server import app, db, Chat


class SecurityRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config["TESTING"] = True
        cls.app = app
        cls.ctx = app.app_context()
        cls.ctx.push()
        db.create_all()

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.drop_all()
        cls.ctx.pop()

    def setUp(self):
        db.session.query(Chat).delete()
        db.session.commit()
        self.client = self.app.test_client()

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
        response = self.client.get("/api/chats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_anonymous_sessions_cannot_impersonate_each_other(self):
        first = self.client.get("/api/chats")
        self.assertEqual(first.status_code, 200)

        with self.client.session_transaction() as session:
            first_user_id = session["dali_user_id"]

        db.session.add(
            Chat(
                id="11111111-1111-4111-8111-111111111111",
                user_id=first_user_id,
                title="Private chat",
            )
        )
        db.session.commit()

        own_chats = self.client.get("/api/chats")
        self.assertEqual(own_chats.status_code, 200)
        self.assertEqual(len(own_chats.get_json()["chats"]), 1)

        attacker = self.app.test_client()
        attacker.get("/api/chats")

        # A forged legacy X-Dali-User header must not grant access.
        response = attacker.get(
            "/api/chats",
            headers={"X-Dali-User": first_user_id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["chats"], [])

    def test_chat_id_must_be_uuid(self):
        response = self.client.get("/api/chats/not-a-real-chat-id")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid chat id", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
