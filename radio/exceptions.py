class ClientError(Exception):
    """Caught by WebSocket receive() handler and returned to client."""

    def __init__(self, message, code):
        self.message = message
        self.code = code
