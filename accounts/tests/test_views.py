from http import HTTPStatus

from django.contrib import auth
from django.test import TestCase

MOCK_USERNAME = 'MockUsername'
MOCK_PASSWORD = 'MockPassword'


class AccountsViewsTests(TestCase):
    def test_user_signup(self):
        response = self.client.post(
            '/join/', {
                'username': MOCK_USERNAME,
                'password1': MOCK_PASSWORD,
                'password2': MOCK_PASSWORD,
            })

        assert response.status_code == HTTPStatus.FOUND.value

        user = auth.get_user(self.client)
        assert user.is_authenticated
        self.client.logout()
