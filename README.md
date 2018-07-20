# Dancing Together

Dancing Together is a website for friends, family, couples, coworkers, and
even Internet strangers to listen to Spotify together. Simply sign up for an
account, create or join a room with friends, select some killer tunes, and
hit play. Each person listens to music using their own Spotify account and
Dancing Together keeps the jammin' in sync. Pause it, skip it, rewind it,
enjoy it!


## Features

* Create your own radio station and invite friends via email
* As the DJ, you can change the music from any Spotify app using the "Connect
  to a device" feature with the "Dancing Together" device
* Listeners are automatically kept in sync with playback changes
* Listeners cannot change the radio station music


## Limitations

* The Dancing Together website only has simple playback controls, it does not
  support setting the current track or playlist directly. To do this, use the
  "Connect to a device" feature on any Spotify app
* There can be only one DJ at a time. This can cause sync issues


## Development

### Installation and First Time Setup

```sh
$ # Install dependencies
$ ./tools/scripts/dev_setup.sh
$ # Add required environment variables
$ cp .env.example .env
$ vim .env
$ # Build containers
$ make build
$ # Run database migrations and create a superuser to administrate the site
$ make db-setup
```

### Docker Usage

```sh
$ # (Re)build the docker containers after updating dependencies
$ make build
$ # Run database migrations and create superuser on containers
$ make db-setup
$ # Start the docker containers
$ make run
$ # Attach to running containers to enable easy debugging with `pdb`
$ make attach
```

**NOTE**: Do not use seed data in production. This creates two accounts,
'primary' and 'secondary', each with password 'testpassword'.


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
- tools/scripts: small scripts for developers
- static: Contains the site's css and js files
- templates: common templates for the entire project
  + base.html: the base template for every page


## Tech Stack

Dancing Together is a Django app running on Heroku.

This project uses the [Pipenv](https://docs.pipenv.org/) Python packaging tool
to manage dependencies, manage virtual environments, and produce deterministic
builds.

### App Dependencies

| Dependency            | How Used                                              | Docs                                                                 |
| ----------            | ------                                                | ----                                                                 |
| Django                | URL routing, database                                 | https://docs.djangoproject.com/en/2.0/                               |
| Requests              | Service-to-service calls (e.g. Spotify API)           | http://docs.python-requests.org/en/master/                           |
| channels_redis        | Admin notifications when a listener joins the station | https://channels.readthedocs.io/en/latest/topics/channel_layers.html |
| django-bootstrap4     | Easy Bootstrap 4 template styling                     | http://django-bootstrap4.readthedocs.io/en/latest/                   |
| django-heroku         | Heroku-specific logging/db configuration              | https://github.com/heroku/django-heroku                              |
| channels              | Websockets for station change notifications           | https://channels.readthedocs.io/en/latest/                           |
| django-webpack-loader | Loads the frontend webpack                            | https://github.com/owais/django-webpack-loader                       |
| djangorestframework   | Provides serialization and REST routing               | http://www.django-rest-framework.org/                                |
| drf-nested-routers    | Used for /stations/1/listeners/ routing               | https://github.com/alanjds/drf-nested-routers                        |

### Additional Development Depedencies

| Dependency      | How Used                                    | Docs                                            |
| ----------      | ------                                      | ----                                            |
| pycodestyle     | Pep8 style checking                         | https://pycodestyle.readthedocs.io/en/latest/   |
| mypy            | Optional static type checking               | http://mypy-lang.org/                           |
| yapf            | Python code formatting                      | https://github.com/google/yapf                  |
| pylint          | Python code analysis                        | https://www.pylint.org/                         |
| pytest-django   | Test fixture support and writing unit tests | https://pytest-django.readthedocs.io/en/latest/ |
| pytest-asyncio  | Websocket consumer tests                    | https://github.com/pytest-dev/pytest-asyncio    |
| python-dateutil | Parsing server ping response                | https://labix.org/python-dateutil               |


## Resources

- [Setting up React and Django](http://v1k45.com/blog/modern-django-part-1-setting-up-django-and-react/)
