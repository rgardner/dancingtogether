import subprocess

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Common commands to work with docker and docker-compose'

    def add_arguments(self, parser):
        parser.add_argument(
            '--build', action='store_true', help='rebuild docker containers')

        group = parser.add_mutually_exclusive_group(required=False)
        group.add_argument(
            '--start', action='store_true', help='start docker containers')
        group.add_argument(
            '--attach-web',
            action='store_true',
            help='start and attach to container running web')
        group.add_argument(
            '--attach-worker',
            action='store_true',
            help='start and attach to container running worker')

    def handle(self, *args, **options):
        if options['build']:
            subprocess.run(['docker-compose', 'build'], check=True)

        if options['start'] or options['attach_web'] or options['attach_worker']:
            subprocess.run(['docker-compose', 'up', '-d'], check=True)
            if options['attach_web']:
                subprocess.run(
                    ['docker', 'attach', 'dancingtogether_web_1'], check=True)
            elif options['attach_worker']:
                subprocess.run(
                    ['docker', 'attach', 'dancingtogether_worker_1'],
                    check=True)
