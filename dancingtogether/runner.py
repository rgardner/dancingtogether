from django.test.runner import DiscoverRunner


class PytestTestRunner(DiscoverRunner):
    """Runs pytest to discover and run tests."""

    def __init__(self,
                 verbosity=1,
                 failfast=False,
                 keepdb=False,
                 junit_xml=None,
                 **kwargs):
        self.verbosity = verbosity
        self.failfast = failfast
        self.keepdb = keepdb
        self.junit_xml = junit_xml

    @classmethod
    def add_arguments(cls, parser):
        parser.add_argument(
            '--junit-xml',
            help='Create junit-xml style report file at given path')

    def run_tests(self, test_labels):
        """Run pytest and return the exitcode.

        It translates some of Django's test command option to pytest's.
        """
        import pytest

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
