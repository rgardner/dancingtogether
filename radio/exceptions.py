class Error(Exception):
    ...


class ClientError(Error):
    """Caught by WebSocket receive() handler and returned to client."""

    def __init__(self, code, message):
        self.code = code
        self.message = message
