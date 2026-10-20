import http.client
import importlib.util
from pathlib import Path
import threading
import unittest
import json
import time

spec = importlib.util.spec_from_file_location("relay_under_test", Path(__file__).resolve().parents[1] / "server.py")
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


class QuietHandler(relay.Handler):
    def log_message(self, *_):
        pass


class RelayHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = relay.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=2)

    def request(self, path, method="GET", payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request(method, path, body=json.dumps(payload) if payload is not None else None,
                               headers={"Origin": "https://campoc.onrender.com", "Content-Type": "application/json"})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_local_ui_redirects_to_render_without_forwarding_query_data(self):
        for path in ("/", "/index.html?token=DO_NOT_FORWARD"):
            status, headers, body = self.request(path)
            self.assertEqual(status, 307)
            self.assertEqual(headers["Location"], "https://campoc.onrender.com/?transport=usb")
            self.assertEqual(body, b"")

    def test_api_remains_local_and_cors_remains_scoped_to_render(self):
        status, headers, body = self.request("/api/info")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://campoc.onrender.com")
        self.assertIn(b"lan-jpeg-v1", body)
        self.assertNotIn("Location", headers)

    def test_diagnostic_page_is_still_available_locally(self):
        status, _, body = self.request("/camera-check.html")
        self.assertEqual(status, 200)
        self.assertIn(b"camera-check.js", body)

    def register(self, room, token):
        return self.request("/api/sessions", "POST", {"room": room, "token": token, "expires": int(time.time()) + 600})

    def test_room_collision_cannot_overwrite_another_token(self):
        self.assertEqual(self.register("ABCDXY", "A" * 32)[0], 201)
        self.assertEqual(self.register("ABCDXY", "B" * 32)[0], 409)
        self.assertEqual(relay.SESSIONS["ABCDXY"]["token"], "A" * 32)

    def test_unused_room_closes_and_removes_credential(self):
        self.register("BCDEFG", "C" * 32)
        status, _, body = self.request("/api/rooms/BCDEFG/close", "POST", {"token": "C" * 32})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["removed"])
        self.assertNotIn("BCDEFG", relay.SESSIONS)

    def test_room_with_camera_consumer_is_kept_when_modal_closes(self):
        self.register("CDEFGH", "D" * 32)
        self.request("/api/rooms/CDEFGH/frame?token=" + "D" * 32)
        status, _, body = self.request("/api/rooms/CDEFGH/close", "POST", {"token": "D" * 32})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["kept"])
        self.assertIn("CDEFGH", relay.SESSIONS)

    def test_stale_token_cannot_close_a_current_usb_room(self):
        self.register("DEFGHJ", "E" * 32)
        _, _, body = self.request("/api/rooms/DEFGHJ/close", "POST", {"token": "F" * 32})
        self.assertFalse(json.loads(body)["removed"])
        self.assertIn("DEFGHJ", relay.SESSIONS)


if __name__ == "__main__":
    unittest.main()
