# Security

The Tattoo Planner is a personal project, published as is and not actively maintained (see the [README](README.md)). It runs only on your own computer: the server listens on `127.0.0.1`, there are no accounts and no telemetry ([docs/privacy.md](docs/privacy.md)).

If you find a vulnerability anyway, please report it privately through GitHub's **Report a vulnerability** button on the repository's Security tab, not in a public issue. Reports are read, but there is no promise of a fix or a timeline.

The automated checks every change goes through (static analysis, secret scanning, dependency audit, a dynamic scan of the running app) are described in [docs/adr/0027-ci-security-pipeline.md](docs/adr/0027-ci-security-pipeline.md).
