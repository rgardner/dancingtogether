# Generated by Django 2.0.3 on 2018-03-21 04:17

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('radio', '0006_spotifycredentials_access_token_expiration_time'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='spotifycredentials',
            options={'verbose_name_plural': 'spotify credentials'},
        ),
    ]