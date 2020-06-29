from django.test.runner import DiscoverRunner
import pytest


class PytestTestRunner(DiscoverRunner):
    """Runs pytest to discover and run tests."""
    def __init__(self, *args, junit_xml=None, **kwargs):
        self.junit_xml = junit_xml
        super().__init__(*args, **kwargs)

    @classmethod
    def add_arguments(cls, parser):
        parser.add_argument(
            '--junit-xml',
            help='Create junit-xml style report file at given path')

    def run_tests(self, test_labels, extra_tests=None, **kwargs):
        """Run pytest and return the exitcode.

        It translates some of Django's test command option to pytest's.
        """
        argv = []
        if self.verbosity == 0:
            argv.append('--quiet')
        elif self.verbosity == 2:
            argv.append('--verbose')
        elif self.verbosity == 3:
            argv.append('-vv')
        if self.failfast:
            argv.append('--exitfirst')
        if self.keepdb:
            argv.append('--reuse-db')
        if self.junit_xml:
            argv.append(f'--junit-xml={self.junit_xml}')

        argv.extend(test_labels)
        return pytest.main(argv)
