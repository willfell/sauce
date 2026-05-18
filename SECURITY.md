# Security policy

## Supported versions

Sauce is solo-developed and ships from `main`. Security fixes are applied to the latest release only; older versions are not patched.

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories:

  https://github.com/willfell/sauce/security/advisories/new

If you cannot use Security Advisories, email: willfellhoelter@gmail.com

I aim to acknowledge reports within 7 days and ship coordinated fixes within 90 days of disclosure.

## Scope

In scope:

- Code in `platform/`, `ranch/`, `commands/`, `scripts/`
- Distribution artifacts (Homebrew formula, install scripts, GitHub Actions workflows)
- The `sauce` CLI itself

Out of scope:

- Personal content placed by consumers under `spice/<module>/`
- Third-party Obsidian plugins vendored under `.obsidian/plugins/` (report to the plugin upstream)
- Bugs that require local filesystem write access already granted by the user
