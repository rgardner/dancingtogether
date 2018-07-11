from django.urls import include, path

from . import views

urlpatterns = [
    path('join/', views.JoinView.as_view(), name='join'),
    path('', include('django.contrib.auth.urls')),
]
