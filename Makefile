.PHONY: build
build:
	docker-compose build

.PHONY: migrate
migrate:
	docker-compose run web python3 manage.py migrate
