from contextlib import closing
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
import json
import re
import socket

import requests

TEST_ACCESS_TOKEN = 'test_access_token'


class MockSpotifyRequestHandler(BaseHTTPRequestHandler):
    TOKEN_PATTERN = re.compile(r'/api/token')

    # BaseHTTPRequestHandler

    def do_POST(self):
        if re.search(self.TOKEN_PATTERN, self.path):
            self.send_response(requests.codes.ok)

            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()

            response_data = {
                'access_token': TEST_ACCESS_TOKEN,
                'expires_in': timedelta(hours=1).seconds,
            }
            response_content = json.dumps(response_data)
            self.wfile.write(response_content.encode('utf-8'))


def get_free_port():
    with closing(socket.socket(socket.AF_INET, type=socket.SOCK_STREAM)) as s:
        s.bind(('localhost', 0))
        _, port = s.getsockname()
        return port


def start_mock_spotify_server(port, handler=MockSpotifyRequestHandler):
    mock_server = HTTPServer(('localhost', port), handler)
    mock_server_thread = Thread(target=mock_server.serve_forever)
    mock_server_thread.setDaemon(True)
    mock_server_thread.start()
