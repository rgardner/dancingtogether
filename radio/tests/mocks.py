from contextlib import closing
from datetime import timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import re
import socket
from threading import Thread

TEST_ACCESS_TOKEN = 'test_access_token'


class MockSpotifyRequestHandler(BaseHTTPRequestHandler):
    TOKEN_PATTERN = re.compile(r'/api/token')

    # BaseHTTPRequestHandler

    # pylint: disable=invalid-name
    def do_POST(self):
        if re.search(self.TOKEN_PATTERN, self.path):
            self.send_response(HTTPStatus.OK.value)

            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()

            response_data = {
                'access_token': TEST_ACCESS_TOKEN,
                'expires_in': timedelta(hours=1).seconds,
            }
            response_content = json.dumps(response_data)
            self.wfile.write(response_content.encode('utf-8'))


def get_free_port():
    with closing(socket.socket(socket.AF_INET,
                               type=socket.SOCK_STREAM)) as sock:
        sock.bind(('localhost', 0))
        _, port = sock.getsockname()
        return port


def start_mock_spotify_server(port, handler=MockSpotifyRequestHandler):
    mock_server = HTTPServer(('localhost', port), handler)
    mock_server_thread = Thread(target=mock_server.serve_forever)
    mock_server_thread.setDaemon(True)
    mock_server_thread.start()
