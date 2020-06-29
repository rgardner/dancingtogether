# pylint: disable=too-few-public-methods
class XContentTypeOptionsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response['X-Content-Type-Options'] = 'nosniff'
        return response


# pylint: disable=too-few-public-methods
class XXssProtectionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response['X-Xss-Protection'] = '1; mode=block'
        return response
