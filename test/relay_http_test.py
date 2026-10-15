import http.client
import importlib.util
from pathlib import Path
import threading
import unittest

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

    def request(self, path):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request("GET", path, headers={"Origin": "https://campoc.onrender.com"})
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


if __name__ == "__main__":
    unittest.main()
