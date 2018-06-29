from django.contrib import admin

from .models import Listener, PlaybackState, SpotifyCredentials, Station


class ListenerInline(admin.TabularInline):
    model = Listener
    extra = 1


class PlaybackStateInline(admin.StackedInline):
    model = PlaybackState


class StationAdmin(admin.ModelAdmin):
    inlines = (ListenerInline, PlaybackStateInline)


admin.site.register(SpotifyCredentials)
admin.site.register(Station, StationAdmin)
