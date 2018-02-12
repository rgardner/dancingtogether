from django.contrib import admin

from .models import Station, Listener, PendingListener


class ListenerInline(admin.TabularInline):
    model = Listener
    extra = 1


class PendingListenerInline(admin.TabularInline):
    model = PendingListener
    extra = 1


class StationAdmin(admin.ModelAdmin):
    inlines = (ListenerInline, PendingListenerInline)


admin.site.register(Station, StationAdmin)
