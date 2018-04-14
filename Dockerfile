FROM python:3.6
ENV PYTHONUNBUFFERED 1
ENV REDIS_HOST "redis"
RUN set -ex && mkdir /app
WORKDIR /app
ADD . /app
RUN set -ex && pip install pipenv --upgrade
RUN set -ex && pipenv install --system --deploy --ignore-pipfile
RUN python manage.py migrate
