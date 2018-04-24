class Error(Exception):
    ...


class ClientError(Error):
    """Caught by WebSocket receive() handler and returned to client."""

    def __init__(self, code, message):
        self.code = code
        self.message = message


# Spotify Errors


class SpotifyError(Error):
    ...


class AccessTokenExpired(SpotifyError):
    ...


class SpotifyAccountNotPremium(SpotifyError):
    ...


class SpotifyDeviceNotFound(SpotifyError):
    ...


class SpotifyServerError(SpotifyError):
    ...
