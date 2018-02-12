# Generated by Django 2.0.2 on 2018-02-12 06:44

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('musicplayer', '0002_room'),
    ]

    operations = [
        migrations.CreateModel(
            name='Membership',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('is_admin', models.BooleanField()),
                ('is_dj', models.BooleanField()),
            ],
        ),
        migrations.CreateModel(
            name='PendingMembership',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ],
        ),
        migrations.RemoveField(
            model_name='room',
            name='admins',
        ),
        migrations.RemoveField(
            model_name='room',
            name='djs',
        ),
        migrations.RemoveField(
            model_name='room',
            name='participants',
        ),
        migrations.RemoveField(
            model_name='room',
            name='pending_users',
        ),
        migrations.AddField(
            model_name='pendingmembership',
            name='room',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='musicplayer.Room'),
        ),
        migrations.AddField(
            model_name='pendingmembership',
            name='user',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='membership',
            name='room',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='musicplayer.Room'),
        ),
        migrations.AddField(
            model_name='membership',
            name='user',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='room',
            name='members',
            field=models.ManyToManyField(through='musicplayer.Membership', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='room',
            name='pending_members',
            field=models.ManyToManyField(related_name='pending_rooms', through='musicplayer.PendingMembership', to=settings.AUTH_USER_MODEL),
        ),
    ]
