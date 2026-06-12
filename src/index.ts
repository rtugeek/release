#!/usr/bin/env node

import { Command } from 'commander';
import { deploy } from './deploy';
import pc from 'picocolors';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const program = new Command();

program
  .name('release')
  .description('A simple CLI to deploy files and run commands on a remote server via SSH')
  .version('1.2.0')
  .argument('[config]', 'Path to the JSON configuration file (defaults to release.json)', 'release.json')
  .option('--hosts', 'List host aliases from ~/.ssh/config')
  .option('--date-version', 'Update package.json version in current working directory to today (yy.m.d)')
  .option('-l, --limit <host>', 'Limit deployment to a specific host')
  .option('--skip-error', 'Skip errors and continue to next host', true)
  .option('--no-skip-error', 'Stop execution if a host fails')
  .action(async (configPath: string, options: { hosts?: boolean; dateVersion?: boolean; limit?: string; skipError: boolean }) => {
    try {
      if (options.hosts) {
        const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');

        if (!fs.existsSync(sshConfigPath)) {
          console.error(pc.red(`SSH config file not found: ${sshConfigPath}`));
          process.exit(1);
        }

        const hostNames = getSshHostNames(sshConfigPath);

        if (hostNames.length === 0) {
          console.log(pc.yellow('No explicit host aliases found in ~/.ssh/config'));
          return;
        }

        hostNames.forEach(host => console.log(host));
        return;
      }

      if (options.dateVersion) {
        updatePackageVersionToToday(process.cwd());
        return;
      }

      await deploy(configPath, options);
    } catch (error: any) {
      console.error(pc.red(`Execution failed: ${error.message || error}`));
      if (error.stack) {
        console.error(pc.gray(error.stack));
      }
      process.exit(1);
    }
  });

program.parse(process.argv);

function getSshHostNames(configPath: string): string[] {
  const fileContent = fs.readFileSync(configPath, 'utf-8');
  const hostNames = new Set<string>();

  for (const line of fileContent.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const match = trimmedLine.match(/^Host\s+(.+)$/i);
    if (!match) {
      continue;
    }

    for (const host of match[1].split(/\s+/)) {
      // Skip wildcard entries such as "*" or "*.example.com".
      if (!host || /[*?]/.test(host)) {
        continue;
      }
      hostNames.add(host);
    }
  }

  return [...hostNames];
}

function updatePackageVersionToToday(cwd: string) {
  const packageJsonPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in current directory: ${cwd}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: string; [key: string]: unknown };
  const nextVersion = formatDateVersion(new Date());
  const currentVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  const versionComparison = compareVersions(currentVersion, nextVersion);

  if (versionComparison > 0) {
    console.log(pc.yellow(`Skip updating version because current version ${currentVersion} is greater than ${nextVersion}`));
    return;
  }

  if (versionComparison === 0) {
    console.log(pc.gray(`Skip updating version because current version is already ${nextVersion}`));
    return;
  }

  packageJson.version = nextVersion;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
  console.log(pc.green(`Updated ${packageJsonPath} version: ${currentVersion} -> ${nextVersion}`));
}

function formatDateVersion(date: Date) {
  const year = date.getFullYear() % 100;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}.${month}.${day}`;
}

function compareVersions(leftVersion: string, rightVersion: string) {
  const leftParts = parseVersionParts(leftVersion);
  const rightParts = parseVersionParts(rightVersion);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const left = leftParts[index] ?? 0;
    const right = rightParts[index] ?? 0;

    if (left > right) {
      return 1;
    }

    if (left < right) {
      return -1;
    }
  }

  return 0;
}

function parseVersionParts(version: string) {
  const normalized = version.trim();

  if (!normalized) {
    return [0];
  }

  return normalized.split('.').map(part => {
    const match = part.match(/^(\d+)/);
    if (!match) {
      return 0;
    }
    return Number.parseInt(match[1], 10);
  });
}
