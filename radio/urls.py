from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='stations'),
    path('<int:station_id>/', views.station),
    path('request-authorization-callback', views.oauth_callback)
]
