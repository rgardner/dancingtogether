from django.urls import include, path

from . import views

urlpatterns = [
    path("join/", views.JoinView.as_view(), name="join"),
    path("<int:pk>/", views.UserDetailView.as_view(), name="account-detail"),
    path("<int:pk>/delete/", views.UserDeleteView.as_view(), name="account-delete"),
    path("", include("django.contrib.auth.urls")),
]
