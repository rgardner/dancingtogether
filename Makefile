.PHONY: run
run:
	docker-compose up -d

.PHONY: build
build:
	docker-compose build

.PHONY: attach-web
attach-web:
	docker attach dancingtogether_web_1

.PHONY: migrate
migrate:
	docker-compose run web python3 manage.py migrate

.PHONY: test
test:
	DJANGO_SETTINGS_MODULE=dancingtogether.settings.test pipenv run python3 manage.py test
