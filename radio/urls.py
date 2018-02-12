from django.urls import path

from . import views

urlpatterns = [
    path('', views.index),
    path('<int:station_id>/', views.station),
    path('request-authorization-callback', views.oauth_callback)
]
