class Error(Exception):
    ...


class ClientError(Error):
    """Caught by WebSocket receive() handler and returned to client."""
    def __init__(self, code, message, *args, **kwargs):
        self.code = code
        self.message = message
        super().__init__(*args, **kwargs)
