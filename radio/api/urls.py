from django.conf.urls import include, re_path
from rest_framework import routers

from . import views

router = routers.DefaultRouter()
router.register(r'', views.StationViewSet)

# Wire up our API using automatic URL routing.
# Additionally, we include login URLs for the browsable API.
urlpatterns = [
    re_path(r'^', include(router.urls)),
    re_path(r'^api-auth/', include('rest_framework.urls')),
]
