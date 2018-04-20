all: run

.PHONY: build
build:
	docker-compose build

.PHONY: migrate
migrate:
	docker-compose run web python3 manage.py migrate

.PHONY: run
run:
	docker-compose up

.PHONY: rund
rund:
	docker-compose up -d

.PHONY: attach
attach:
	docker attach dancingtogether_web_1

.PHONY: test
test:
	DJANGO_SETTINGS_MODULE=dancingtogether.settings.test pipenv run python3 manage.py test

.PHONY: deploy
deploy:
	git push heroku HEAD:master
