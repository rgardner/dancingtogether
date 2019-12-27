from http import HTTPStatus

from accounts.models import User
from django.contrib import auth
from django.test import TestCase
import pytest

MOCK_USERNAME = "MockUsername"
MOCK_USERNAME2 = "MockUsername2"
MOCK_PASSWORD = "MockPassword"
MOCK_PASSWORD2 = "MockPassword2"


class AccountsViewsTests(TestCase):
    def tearDown(self):
        self.client.logout()
        auth.get_user_model().objects.all().delete()

    def test_user_sign_up(self):
        response = self.client.post(
            "/join/",
            {
                "username": MOCK_USERNAME,
                "password1": MOCK_PASSWORD,
                "password2": MOCK_PASSWORD,
            },
        )
        self.assertRedirects(response, "/stations/")

        user = auth.get_user(self.client)
        assert user.is_authenticated

    def test_user_sign_up_already_logged_in(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.get("/join/")
        self.assertRedirects(response, "/")

        response = self.client.post(
            "/join/",
            {
                "username": MOCK_USERNAME,
                "password1": MOCK_PASSWORD,
                "password2": MOCK_PASSWORD,
            },
        )
        self.assertRedirects(response, "/")

    def test_user_login(self):
        user = create_user()
        response = self.client.post(
            "/login/", {"username": MOCK_USERNAME, "password": MOCK_PASSWORD,}
        )
        self.assertRedirects(response, "/stations/")

        assert user.is_authenticated

    def test_user_login_already_logged_in(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.get("/login/")
        self.assertRedirects(response, "/")

        response = self.client.post(
            "/login/", {"username": MOCK_USERNAME, "password": MOCK_PASSWORD,}
        )
        self.assertRedirects(response, "/")

    def test_user_can_see_profile(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.get(f"/accounts/{user.id}/")
        assert response.status_code == HTTPStatus.OK.value

    def test_user_can_only_see_their_profile(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.get("/accounts/2/")
        self.assertRedirects(response, "/")

    def test_user_needs_to_be_logged_in_to_see_profile(self):
        response = self.client.get("/accounts/1/")
        self.assertRedirects(response, "/accounts/login/?next=/accounts/1/")

    def test_user_can_change_password(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.post(
            f"/accounts/{user.id}/",
            {
                "old_password": MOCK_PASSWORD,
                "new_password1": MOCK_PASSWORD2,
                "new_password2": MOCK_PASSWORD2,
            },
        )
        self.assertRedirects(response, f"/accounts/{user.id}/")

        self.client.logout()
        assert self.client.login(username=MOCK_USERNAME, password=MOCK_PASSWORD2)

    def test_user_can_only_change_their_password(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.post(
            f"/accounts/2/",
            {
                "old_password": MOCK_PASSWORD,
                "new_password1": MOCK_PASSWORD2,
                "new_password2": MOCK_PASSWORD2,
            },
        )
        self.assertRedirects(response, "/")

    def test_user_needs_to_be_logged_in_to_change_password(self):
        response = self.client.post(
            f"/accounts/1/",
            {
                "old_password": MOCK_PASSWORD,
                "new_password1": MOCK_PASSWORD2,
                "new_password2": MOCK_PASSWORD2,
            },
        )
        self.assertRedirects(response, "/accounts/login/?next=/accounts/1/")

    def test_user_can_delete_account(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.post(f"/accounts/{user.id}/delete/")
        self.assertRedirects(response, "/")
        with pytest.raises(auth.get_user_model().DoesNotExist):
            auth.get_user_model().objects.get(id=user.id)

    def test_user_can_delete_only_their_account(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.post(f"/accounts/2/delete/")
        self.assertRedirects(response, "/")

    def test_user_needs_to_be_logged_in_to_delete_account(self):
        user = create_user()
        response = self.client.post(f"/accounts/{user.id}/delete/")
        self.assertRedirects(
            response, f"/accounts/login/?next=/accounts/{user.id}/delete/"
        )


def create_user(username=MOCK_USERNAME) -> User:
    return auth.get_user_model().objects.create_user(
        username=MOCK_USERNAME, password=MOCK_PASSWORD
    )
