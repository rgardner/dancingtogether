all: run

.PHONY: build
build:
	docker-compose build
	npm install

.PHONY: db-makemigrations
db-makemigrations:
	docker-compse run web python3 manage.py makemigrations

.PHONY: db-migrate
db-migrate:
	docker-compose run web python3 manage.py migrate

.PHONY: db-createsuperuser
db-createsuperuser:
	docker-compose run web python3 manage.py createsuperuser

.PHONY: db-setup
db-setup: db-migrate db-createsuperuser

.PHONY: run
run:
	docker-compose up

.PHONY: rund
rund:
	docker-compose up --detach

.PHONY: stop
stop:
	docker-compose down

.PHONY: watch
watch:
	npm run watch

.PHONY: attach
attach:
	docker attach dancingtogether_web_1

.PHONY: shell
shell:
	docker-compose run web python3 manage.py shell

.PHONY: test
test: client-test server-test

.PHONY: client-test
client-test:
	npm test

.PHONY: server-test
server-test:
	DJANGO_SETTINGS_MODULE=dancingtogether.settings.test pipenv run python3 manage.py test

.PHONY: deploy
deploy:
	git push heroku HEAD:master
