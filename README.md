# @widget-js/release

[!\[npm version\](https://img.shields.io/npm/v/@widget-js/release.svg null)](https://www.npmjs.com/package/@widget-js/release)
[!\[npm downloads\](https://img.shields.io/npm/dm/@widget-js/release.svg null)](https://www.npmjs.com/package/@widget-js/release)
[!\[License: MIT\](https://img.shields.io/badge/License-MIT-yellow.svg null)](https://opensource.org/licenses/MIT)

A lightweight, lightning-fast Node.js CLI tool that helps you copy files/folders to a remote server and execute commands via SSH. Designed for developers who want a simple, scriptable deployment process without the overhead of heavy automation frameworks.

### Features
- 🪶 **Extremely Lightweight**: No complex setup, just a simple JSON file.
- 🚀 **Fast**: Glob pattern matching and concurrency support for file uploads.
- 🔑 **Smart SSH**: Automatically parses your `~/.ssh/config` for aliases, users, and private keys.
- 🛡️ **Interactive**: Prompts for encrypted SSH key passphrases on-the-fly and caches them.
- 🌍 **Multi-Host**: Deploy to one or multiple servers sequentially with a single command.

## Why not Ansible? (Comparison)

While [Ansible](https://www.ansible.com/) is an incredibly powerful industry standard for IT automation, it can often be overkill for everyday developer tasks.

| Feature / Aspect | `@widget-js/release` | Ansible |
| :--- | :--- | :--- |
| **Best For** | Simple frontend/Node.js deployments, personal projects | Bare-metal provisioning, complex enterprise infrastructure |
| **Learning Curve** | **Zero** (Basic JSON and shell commands) | **High** (Requires learning YAML, Playbooks, Inventory) |
| **Ecosystem** | Node.js (No Python dependency required) | Python-based |
| **Configuration** | A single straightforward JSON array | Complex directory structures, Roles, and Playbooks |
| **Idempotency** | No (Runs commands exactly as defined) | Yes (Ensures specific state without rerunning) |
| **Core Action** | Simply "copy files & run commands" | Full system configuration & state management |

## Installation

Install the package globally using npm or yarn:

```bash
npm install -g @widget-js/release
# or
yarn global add @widget-js/release
```

Or run it directly using `npx`:

```bash
npx @widget-js/release
```

## Configuration

Create a JSON file (e.g., `release.json`) to define your deployment script.

### Example `release.json`:

```json
{
  "host": ["192.168.1.100", "nyhq"],
  "port": 22,
  "username": "root",
  "password": "your-password",
  "privateKey": "./path/to/private-key.pem",
  "passphrase": "your-key-passphrase",
  "steps": [
    {
      "type": "upload",
      "local": "./dist",
      "remote": "/var/www/app/dist",
      "pattern": "**/*",
      "ignore": ["**/*.map", "node_modules/**"]
    },
    {
      "type": "command",
      "command": "cd /var/www/app && yarn install"
    },
    {
      "type": "upload",
      "local": "./package.json",
      "remote": "/var/www/app/package.json"
    },
    {
      "type": "command",
      "command": "cd /var/www/app && pm2 restart my-app"
    }
  ]
}
```

### Configuration Fields:

- `host` (string | Array): The server's IP address, hostname, or **SSH Alias**. You can pass a single string or an array of strings to deploy to multiple servers. The CLI will automatically parse `~/.ssh/config` to resolve HostName, User, Port, and IdentityFile if an alias is provided.
- `port` (number, optional): SSH port. Default is `22`. (Can be read from `~/.ssh/config`)
- `username` (string, optional): SSH username. (Can be read from `~/.ssh/config`)
- `password` (string, optional): SSH password. You can also use `privateKey` instead.
- `privateKey` (string, optional): Path to your SSH private key file. (Can be read from `~/.ssh/config`'s `IdentityFile`)
- `passphrase` (string, optional): Passphrase for the private key, if it is encrypted.
- `steps` (Array): An ordered list of steps to execute.
  - **Upload Step**
    - `type`: `"upload"`
    - `local` (string): Local path relative to where you run the command.
    - `remote` (string): Absolute path on the remote server.
    - `pattern` (string, optional): Glob pattern to filter files (e.g., `"**/*.js"`).
    - `ignore` (string | Array, optional): Glob pattern(s) to ignore (e.g., `"**/*.map"`).
  - **Command Step**
    - `type`: `"command"`
    - `command` (string): Shell command to execute on the remote server.

## Usage

```bash
# If no file is specified, it defaults to 'release.json'
release

# Or specify a custom config file
release ./custom-config.json

# Limit deployment to a specific host defined in your config
release --limit nyhq

# Stop execution if any host fails (by default, it skips errors and continues)
release --no-skip-error
```

