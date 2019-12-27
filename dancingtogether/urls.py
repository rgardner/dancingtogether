"""dancingtogether URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/2.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path

import accounts.views
import main.views

urlpatterns = [
    path("", main.views.index, name="homepage"),
    path("about/", main.views.about, name="about"),
    path("contact/", main.views.contact, name="contact"),
    path("accounts/", include("accounts.urls")),
    path("admin/", admin.site.urls),
    path("join/", accounts.views.JoinView.as_view(), name="join"),
    path("login/", accounts.views.LoginView.as_view(), name="login"),
    path("logout/", accounts.views.LogoutView.as_view(), name="logout"),
    path("api/v1/", include("radio.api.urls")),
    path("stations/", include("radio.urls", namespace="radio")),
]
