# Dancing Together

Dancing Together is a website for friends, family, couples, coworkers, and
even Internet strangers to listen to Spotify together. Simply sign up for an
account, create or join a room with friends, select some killer tunes, and
hit play. Each person listens to music using their own Spotify account and
Dancing Together keeps the jammin' in sync. Pause it, skip it, rewind it,
enjoy it!


## Development

### Installation and First Time Setup

```sh
$ # Install dependencies
$ ./scripts/dev_setup.sh
$ # Add required environment variables
$ cp .env.example .env
$ vim .env
$ # Build containers and run database migrations
$ make build && make migrate
$ # Create a superuser account to administrate the site
$ docker-compose run web python3 manage.py createsuperuser
```

### Docker Usage

```sh
$ # (Re)build the docker containers after updating dependencies
$ make build
$ # Run database migrations on containers
$ make migrate
$ # Start the docker containers
$ make run
$ # Attach to running containers to enable easy debugging with `pdb`
$ make attach
```

### Testing

```sh
$ make test
```

### Deployment

```sh
$ make deploy
```


### Code Map

- Dockerfile
- Pipfile: specifies project dependencies
- Pipfile.lock: pins dependency versions to ensure deterministic builds
- Procfile: specifies how to start the app on Heroku
- README.md: this file
- accounts: Django app for managing user accounts
- app.json: specifies configuration for Heroku
- dancingtogether: the main Django project, contains overall url routing
- docker-compose.yml: specifies Docker services that compose this project
- main: Django app for site index and management commands
- manage.py: Program for running management commands
- radio: Django app for listening to music
- scripts: small scripts for developers
- static: Contains the site's css and js files
- templates: common templates for the entire project
  + base.html: the base template for every page


## Tech Stack

Dancing Together is a Django app running on Heroku.

| Dependency      | How Used                                    | Docs                                       |
| ----------      | ------                                      | ----                                       |
| Django          | URL routing, database                       | https://docs.djangoproject.com/en/2.0/     |
| Requests        | Service-to-service calls (e.g. Spotify API) | http://docs.python-requests.org/en/master/ |
| python-dateutil | Parsing ISO 1601 date times                 | https://labix.org/python-dateutil          |
| Pipenv          | Python packing tool                         | https://docs.pipenv.org/                   |
