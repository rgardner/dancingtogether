from django.contrib import auth
from django.contrib.auth.views import LoginView, LogoutView
from django.urls import reverse_lazy
from django.views.generic.edit import CreateView

from .forms import CustomUserCreationForm
from .models import User


class JoinView(CreateView):
    model = User
    form_class = CustomUserCreationForm
    template_name = 'registration/join.html'
    success_url = reverse_lazy('radio:index')

    def form_valid(self, form):
        response = super().form_valid(form)
        auth.login(self.request, self.object)
        return response
