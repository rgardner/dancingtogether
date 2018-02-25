web: bin/start-pgbouncer-stunnel daphne --bind 0.0.0.0 --port $PORT dancingtogether.asgi:application
worker: bin/start-pgbouncer-stunnel python manage.py runworker spotify-dispatcher
