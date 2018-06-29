from django.urls import path

from . import views

app_name = 'radio'

urlpatterns = [
    path('', views.IndexView.as_view(), name='index'),
    path('<int:pk>/', views.DetailStationView.as_view(), name='detail'),
    path('<int:pk>/delete/', views.DeleteStationView.as_view(), name='delete'),
    path('request-authorization-callback', views.oauth_callback)
]
