from django.contrib import auth
from django.test import TestCase

MockUsername = 'MockUsername'
MockPassword = 'MockPassword'


class AccountsViewsTests(TestCase):
    def test_user_signup(self):
        response = self.client.post(
            '/join/', {
                'username': MockUsername,
                'password1': MockPassword,
                'password2': MockPassword,
            })

        assert response.status_code == 302

        user = auth.get_user(self.client)
        assert user.is_authenticated
        self.client.logout()
