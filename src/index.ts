#!/usr/bin/env node

import { Command } from 'commander';
import { deploy } from './deploy';
import pc from 'picocolors';

const program = new Command();

program
  .name('release')
  .description('A simple CLI to deploy files and run commands on a remote server via SSH')
  .version('1.0.0')
  .argument('[config]', 'Path to the JSON configuration file (defaults to release.json)', 'release.json')
  .option('-l, --limit <host>', 'Limit deployment to a specific host')
  .option('--skip-error', 'Skip errors and continue to next host', true)
  .option('--no-skip-error', 'Stop execution if a host fails')
  .action(async (configPath: string, options: { limit?: string; skipError: boolean }) => {
    try {
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