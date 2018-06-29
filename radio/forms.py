from django.forms import ModelForm

from .models import Station


class StationForm(ModelForm):
    class Meta:
        model = Station
        fields = ['title']
