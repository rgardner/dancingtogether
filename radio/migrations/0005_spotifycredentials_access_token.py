# Generated by Django 2.0.2 on 2018-02-21 02:46

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('radio', '0004_station_position_ms'),
    ]

    operations = [
        migrations.AddField(
            model_name='spotifycredentials',
            name='access_token',
            field=models.CharField(default='foobar', max_length=256),
            preserve_default=False,
        ),
    ]
