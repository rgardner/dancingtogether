FROM python:3.7
ENV PYTHONUNBUFFERED 1

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get install -y nodejs
RUN npm install -g webpack webpack-bundle-tracker typescript ts-loader

RUN set -ex && mkdir /app
WORKDIR /app

ADD Pipfile /app
ADD Pipfile.lock /app
RUN set -ex && pip install pipenv --upgrade
RUN set -ex && pipenv install --dev --system --ignore-pipfile --deploy

ADD . /app
