# Dancing Together

Dancing Together is a website for friends, family, couples, coworkers, and even
Internet strangers to listen to Spotify together. Simply sign up for an
account, create or join a room with friends, select some killer tunes, and hit
play. The music stays in sync so you can all listen together. Pause it, skip
it, rewind it, enjoy it!


## Development

Want to run it locally? Simply run `dev_setup.sh` to install dependencies, set
up heroku deployment, and run the initial database migrations. Then create the
superuser and set the values in `.env`.

```sh
$ ./scripts/dev_setup.sh
$ python manage.py createsuperuser
$ cp .env.example .env
$ vim .env
```

Now you're ready to run the local server!

```sh
$ heroku local web
```

### Code Map

- Pipfile: specifies project dependencies
- Pipfile.lock: pins dependency versions to ensure deterministic builds
- Procfile: specifies how to start the app, use for macOS/Ubuntu
- Procfile.windows: specifies how to start the app, use for Windows
- README.md: this file
- accounts: Django app for managing user accounts
- app.json: specifies configuration for Heroku
- dancingtogether: the main Django app
- musicplayer: Django app for listening to music
- scripts: small scripts for developers
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
