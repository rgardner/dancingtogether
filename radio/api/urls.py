from django.conf.urls import include, re_path
from rest_framework_nested import routers

from . import views

router = routers.SimpleRouter()
router.register(r'', views.StationViewSet)

listeners_router = routers.NestedSimpleRouter(router, r'', lookup='station')
listeners_router.register(
    r'listeners', views.ListenerViewSet, base_name='station-listeners')

# Wire up our API using automatic URL routing.
# Additionally, we include login URLs for the browsable API.
urlpatterns = [
    re_path(r'^', include(router.urls)),
    re_path(r'^', include(listeners_router.urls)),
    re_path(r'^api-auth/', include('rest_framework.urls')),
]
