from django.conf.urls import include, re_path
from rest_framework_nested import routers

from . import views

router = routers.SimpleRouter()
router.register(r'stations', views.StationViewSet)

listeners_router = routers.NestedSimpleRouter(
    router, r'stations', lookup='station')
listeners_router.register(
    r'listeners', views.ListenerViewSet, basename='listeners')

# Wire up our API using automatic URL routing.
# Additionally, we include login URLs for the browsable API.
urlpatterns = [
    re_path(r'^', include(router.urls)),
    re_path(r'^', include(listeners_router.urls)),
    re_path(r'^users/(?P<user_pk>[^/.]+)/accesstoken/refresh/$',
            views.RefreshAccessToken.as_view()),
    re_path(r'^api-auth/', include('rest_framework.urls')),
]
