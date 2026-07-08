---
name: release
description: Uses @widget-js/release for SSH deployment. Invoke when users want to create, edit, validate, or run `release.json` based upload/command deployment flows.
---

# Release Deploy

Use this skill for the local `@widget-js/release` project.

Invoke this skill when the user wants to:

- create or edit `release.json`
- deploy files to one or more servers over SSH
- add upload steps or remote command steps
- limit deployment to a single host
- troubleshoot `release` CLI behavior, SSH config resolution, key usage, or step execution

Do not use this skill for:

- Docker, Kubernetes, Ansible, or CI/CD pipeline design unrelated to this CLI
- generic SCP/rsync workflows that are not based on `@widget-js/release`

## Tool Summary

`@widget-js/release` is a Node.js CLI that:

- reads a JSON config file, defaulting to `release.json`
- deploys to one host or multiple hosts sequentially
- supports two step types: `upload` and `command`
- resolves SSH aliases and defaults from `~/.ssh/config`
- falls back to `~/.ssh/id_rsa` if neither `password` nor `privateKey` is provided
- prompts for encrypted key passphrases and caches them during the session

CLI usage:

```bash
release
release ./custom-config.json
release --hosts
release --date-version
release --limit nyhq
release --no-skip-error
```

## Config Shape

Expected top-level fields:

```json
{
  "$schema": "https://raw.githubusercontent.com/rtugeek/release/refs/heads/master/release.schema.json",
  "host": ["127.0.0.1", "localhost", "nyhq"],
  "port": 22,
  "username": "root",
  "password": "optional-password",
  "privateKey": "./path/to/key",
  "passphrase": "optional-passphrase",
  "steps": [
    {
      "type": "upload",
      "local": "./src",
      "remote": "/tmp/src",
      "pattern": "**/*.ts",
      "ignore": ["**/*.spec.ts"]
    },
    {
      "type": "command",
      "command": "echo 'upload completed'"
    }
  ]
}
```

Field rules:

- `host`: string or string array; hostnames and SSH aliases are supported
- `port`: optional; defaults to `22`
- `username`: optional if provided by `~/.ssh/config`
- `password`: optional; use with care
- `privateKey`: optional path to private key
- `passphrase`: optional; can also be entered interactively
- `steps`: ordered list executed on each selected host

Step rules:

- `upload`:
  - `local` is a local file or directory path
  - `remote` is the destination path on the remote server
  - `pattern` filters files when `local` is a directory
  - `ignore` excludes matching files (string or string array)
- `command`:
  - `command` runs on the remote server after prior steps finish

## Working Rules

When helping with this project:

1. Read the current `release.json` before proposing edits.
2. Preserve the existing deployment order unless the user asks to restructure it.
3. Keep `local` paths relative to the repo root unless the user explicitly wants absolute paths.
4. Prefer absolute Linux-style paths for `remote`.
5. Do not remove authentication fields or host entries unless the user asks.
6. Prefer validating `release.json` via JSON Schema: keep `$schema` pointing to `https://raw.githubusercontent.com/rtugeek/release/refs/heads/master/release.schema.json` for editor validation and autocomplete.
7. When the user wants to deploy to only one machine, prefer `release --limit <host>`.
8. When the user wants fail-fast behavior, use `--no-skip-error`.
9. When the user wants to inspect SSH aliases from `~/.ssh/config`, prefer `release --hosts`.
10. If `pattern` is present, ensure it matches files relative to the `local` directory.
11. If `ignore` is present, ensure it is compatible with glob patterns.
12. Mention that host selection is interactive, even when multiple hosts are listed in config.

## Repo-Specific Notes

Current implementation behavior:

- the CLI entry is `src/index.ts`
- deployment logic is in `src/deploy.ts`
- config types are defined in `src/types.ts`
- config JSON schema is `release.schema.json` (copied to `dist/release.schema.json` during build), also available at `https://raw.githubusercontent.com/rtugeek/release/refs/heads/master/release.schema.json`
- `release --hosts` prints explicit host aliases from `~/.ssh/config`
- `release --date-version` updates `package.json` version in the current working directory to today (`yy.m.d`)
- supported step types are only `upload` and `command`
- unknown step types are warned and skipped
- upload directories can use glob filtering with `pattern` and `ignore`
- command failures are printed; host-level failure handling depends on `--skip-error` and `--no-skip-error`

## Response Pattern

When the user asks for help, structure the work like this:

1. Summarize the intended deployment target and config changes.
2. Show the exact `release.json` changes or the full config if that is easier.
3. If execution is requested, give the exact `release` command to run.
4. Call out any assumptions about SSH auth, remote directories, or missing build steps.
5. Warn about risky commands such as deleting remote files or restarting production services.

## Good Examples

Example: add a build artifact upload and restart command

```json
{
  "$schema": "https://raw.githubusercontent.com/rtugeek/release/refs/heads/master/release.schema.json",
  "host": ["prod"],
  "steps": [
    {
      "type": "upload",
      "local": "./dist",
      "remote": "/var/www/app/dist",
      "pattern": "**/*",
      "ignore": ["**/*.map"]
    },
    {
      "type": "command",
      "command": "cd /var/www/app && pm2 restart app"
    }
  ]
}
```

Example: deploy only to one alias

```bash
release --limit prod
```

Example: list SSH aliases from local SSH config

```bash
release --hosts
```

## Validation Checklist

Before finishing, check:

- `host` exists and is not empty
- every step has a valid `type`
- every `upload` step has both `local` and `remote`
- every `command` step has `command`
- `pattern` and `ignore` are only used where relevant
- remote commands run in the intended directory
- any required build step is handled before deployment
