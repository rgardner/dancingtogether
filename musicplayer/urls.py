from django.urls import path

from . import views

urlpatterns = [
    path('rooms/', views.room),
    path('rooms/<int:room_id>/', views.room)
]
