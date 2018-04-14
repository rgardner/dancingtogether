class ClientError(Exception):
    """Caught by WebSocket receive() handler and returned to client."""

    def __init__(self, code, message):
        self.code = code
        self.message = message


# Spotify Errors


class AccessTokenExpired(Exception):
    pass


class SpotifyAccountNotPremium(Exception):
    pass


class SpotifyDeviceNotFound(Exception):
    pass
