FROM python:3.8.1
ENV PYTHONUNBUFFERED 1

RUN ["/bin/bash", "-c", "set -o pipefail && curl -sL https://deb.nodesource.com/setup_10.x | bash -"]
# Update and install dependencies, and remove the package manager cache. Do
# this in a single step for better caching.
RUN apt-get --yes update && apt-get install --yes --no-install-recommends \
  libpq-dev \
  nodejs \
  && rm -rf /var/lib/apt/lists/*
RUN pip install pipenv
RUN npm install --global \
  ts-loader \
  typescript \
  webpack \
  webpack-bundle-tracker

RUN mkdir /app
COPY Pipfile Pipfile.lock /app/
WORKDIR /app
RUN set -ex && pipenv install --dev --system --ignore-pipfile --deploy

COPY . /app
