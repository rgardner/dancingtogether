from django.contrib import admin

from .models import Room, Membership, PendingMembership


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 1


class PendingMembershipInline(admin.TabularInline):
    model = PendingMembership
    extra = 1


class RoomAdmin(admin.ModelAdmin):
    inlines = (MembershipInline, PendingMembershipInline)


admin.site.register(Room, RoomAdmin)
