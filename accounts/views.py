"""Django views for sign up, sign in, sign out, delete account, etc."""

from django.contrib import auth
from django.contrib.auth.forms import PasswordChangeForm
from django.contrib.auth.mixins import LoginRequiredMixin
# pylint: disable=unused-import
from django.contrib.auth.views import LoginView as DefaultLoginView, LogoutView, PasswordChangeView
from django.shortcuts import redirect
from django.urls import reverse, reverse_lazy
from django.views import View
from django.views.generic import DetailView
# pylint: disable=unused-import
from django.views.generic.edit import CreateView, DeleteView, UpdateView

from .forms import CustomUserCreationForm
from .models import User


class JoinView(CreateView):
    """Sign up view."""
    model = User
    form_class = CustomUserCreationForm
    template_name = 'registration/join.html'
    success_url = reverse_lazy('radio:index')

    def get(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect('homepage')
        else:
            return super().get(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect('homepage')
        else:
            return super().post(request, *args, **kwargs)

    def form_valid(self, form):
        response = super().form_valid(form)
        auth.login(self.request, self.object)
        return response


class LoginView(DefaultLoginView):
    def get(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect('homepage')
        else:
            return super().get(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect('homepage')
        else:
            return super().post(request, *args, **kwargs)


class UserDetailView(LoginRequiredMixin, View):
    def get(self, request, *args, **kwargs):
        view = ShowUserDetailView.as_view()
        return view(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        view = UserPasswordChangeDoneView.as_view()
        return view(request, *args, **kwargs)


class ShowUserDetailView(DetailView):
    model = User
    template_name = 'accounts/detail.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['password_change_form'] = PasswordChangeForm(self.request.user)
        return context

    def get(self, request, *args, **kwargs):
        if request.user.id == kwargs['pk']:
            return super().get(request, *args, **kwargs)
        else:
            return redirect('/')


class UserPasswordChangeDoneView(PasswordChangeView):
    template_name = 'accounts/detail.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['password_change_form'] = PasswordChangeForm(self.request.user)
        return context

    def get_success_url(self):
        return reverse('account-detail', kwargs={'pk': self.request.user.id})

    def post(self, request, *args, **kwargs):
        if request.user.id == kwargs['pk']:
            return super().post(request, *args, **kwargs)
        else:
            return redirect('homepage')


class UserDeleteView(LoginRequiredMixin, DeleteView):
    model = User
    success_url = reverse_lazy('homepage')

    def post(self, request, *args, **kwargs):
        if request.user.id == kwargs['pk']:
            return super().post(request, *args, **kwargs)
        else:
            return redirect('homepage')
