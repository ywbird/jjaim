"""Error types and their exit codes."""


class CliError(Exception):
    """Base class for errors with a documented process exit code."""

    code = 1


class UsageError(CliError):
    """Command-line usage error (exit 2)."""

    code = 2


class DeclError(CliError):
    """Declaration syntax or semantic error (exit 3)."""

    code = 3


class ResourceError(CliError):
    """Missing or unusable texture/output resource (exit 4)."""

    code = 4
