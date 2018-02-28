from django.contrib import admin

from .models import SpotifyCredentials, Station, Listener, PendingListener


class ListenerInline(admin.TabularInline):
    model = Listener
    extra = 1


class PendingListenerInline(admin.TabularInline):
    model = PendingListener
    extra = 1


class StationAdmin(admin.ModelAdmin):
    inlines = (ListenerInline, PendingListenerInline)


admin.site.register(SpotifyCredentials)
admin.site.register(Station, StationAdmin)
