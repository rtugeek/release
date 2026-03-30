import { NodeSSH } from 'node-ssh';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import pc from 'picocolors';
import { glob } from 'glob';
import SSHConfig from 'ssh-config';
import prompts from 'prompts';
import { checkbox } from '@inquirer/prompts';
import ora from 'ora';
import Table from 'cli-table3';
import { DeployConfig, Step, UploadStep, CommandStep } from './types';
import { log } from 'console';

// Global cache for passphrase to avoid prompting multiple times
let cachedPassphrase = '';

interface DeployResult {
  host: string;
  ip: string;
  success: boolean;
  error?: string;
}

export async function deploy(configPath: string, options?: { limit?: string; skipError?: boolean }) {
  const fullPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    console.error(pc.red(`Error: Configuration file not found at ${fullPath}`));
    process.exit(1);
  }

  let config: DeployConfig;
  try {
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    config = JSON.parse(fileContent);
  } catch (err) {
    console.error(pc.red(`Error: Failed to parse configuration file. Please ensure it is valid JSON.`));
    process.exit(1);
  }

  let hosts = Array.isArray(config.host) ? config.host : [config.host];

  if (options?.limit) {
    hosts = hosts.filter(h => h === options.limit);
    if (hosts.length === 0) {
      console.warn(pc.yellow(`Warning: No host found matching limit '${options.limit}' in the configuration.`));
      return;
    }
  }

  if (hosts.length > 0) {
    const selectedHosts = await checkbox({
      message: 'Select hosts to deploy to:',
      choices: hosts.map(h => ({
        name: h,
        value: h,
        checked: true,
      })),
    });

    if (selectedHosts.length === 0) {
      console.log(pc.yellow('No hosts selected. Aborting deployment.'));
      return;
    }
    hosts = selectedHosts;
  }

  console.log(pc.blue(`\nStarting deployment to ${hosts.length} host(s)...\n`));

  const results: DeployResult[] = [];

  for (const host of hosts) {
    const separator = pc.cyan('='.repeat(60));
    console.log(`\n${separator}`);
    console.log(`${pc.bgCyan(pc.black(' 🚀 DEPLOYING TO HOST '))} ${pc.bold(pc.cyan(host))}`);
    console.log(`${separator}\n`);
    
    const result = await deployToHost(host, config);
    results.push(result);
    
    console.log(`\n${separator}`);
    const statusText = result.success ? pc.bgGreen(pc.black(' ✅ SUCCESS ')) : pc.bgRed(pc.white(' ❌ FAILED '));
    console.log(`${statusText} ${pc.bold(host)}`);
    console.log(`${separator}\n`);
    
    if (!result.success && options?.skipError === false) {
      console.log(pc.red(`Deployment to ${host} failed and --no-skip-error is set. Aborting remaining deployments.`));
      break;
    }
  }
  
  console.log(pc.green(`\nAll deployments completed!`));

  console.log(pc.blue('\nDeployment Summary:'));
  
  const table = new Table({
    head: [pc.cyan('Hostname'), pc.cyan('IP'), pc.cyan('运行结果'), pc.cyan('失败原因')],
    style: { head: [] }, // Disable default colors to let picocolors work
    wordWrap: true,
  });

  results.forEach(r => {
    table.push([
      r.host,
      r.ip,
      r.success ? pc.green('✅ 成功') : pc.red('❌ 失败'),
      r.error ? pc.red(r.error) : pc.gray('-')
    ]);
  });

  console.log(table.toString());
}

async function deployToHost(host: string, config: DeployConfig): Promise<DeployResult> {
  const ssh = new NodeSSH();

  // Parse SSH config
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  let sshOptions: any = {
    host: host,
    port: config.port || 22,
    username: config.username,
    password: config.password,
    privateKey: config.privateKey ? path.resolve(process.cwd(), config.privateKey) : undefined,
    passphrase: config.passphrase,
  };

  if (fs.existsSync(sshConfigPath)) {
    try {
      const sshConfigFile = fs.readFileSync(sshConfigPath, 'utf-8');
      const parsedConfig = SSHConfig.parse(sshConfigFile);
      const computedConfig = parsedConfig.compute(host);

      if (computedConfig) {
        if (computedConfig.HostName) {
          sshOptions.host = computedConfig.HostName;
        }
        if (computedConfig.User && !config.username) {
          sshOptions.username = computedConfig.User;
        }
        if (computedConfig.Port && !config.port) {
          sshOptions.port = parseInt(computedConfig.Port, 10);
        }
        if (computedConfig.IdentityFile && computedConfig.IdentityFile.length > 0 && !config.privateKey && !config.password) {
          // IdentityFile could be an array or string. Handle array case by picking the first one.
          const identityFile = Array.isArray(computedConfig.IdentityFile) 
            ? computedConfig.IdentityFile[0] 
            : computedConfig.IdentityFile;
            
          // Expand ~ to homedir
          const expandedPath = identityFile.startsWith('~') 
            ? path.join(os.homedir(), identityFile.slice(1)) 
            : identityFile;
          sshOptions.privateKey = expandedPath;
        }
      }
    } catch (err) {
      console.warn(pc.yellow(`Warning: Failed to parse ~/.ssh/config: ${err}`));
    }
  }

  // Ensure username is provided either from JSON or SSH config
  if (!sshOptions.username) {
    const errorMsg = `Username is required for host ${host}. Please provide it in the config file or ~/.ssh/config.`;
    console.error(pc.red(`Error: ${errorMsg}`));
    return { host, ip: sshOptions.host, success: false, error: errorMsg };
  }

  // Fallback to default private key if no authentication method is provided
  if (!sshOptions.password && !sshOptions.privateKey) {
    const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
    console.log(pc.gray(`No private key provided for ${host}, falling back to default: ${defaultKeyPath}`));
    if (fs.existsSync(defaultKeyPath)) {
      sshOptions.privateKey = defaultKeyPath;
    }
  }

  // Use cached passphrase if available and not explicitly provided
    if (!sshOptions.passphrase && cachedPassphrase) {
      sshOptions.passphrase = cachedPassphrase;
    }

    // Read private key content from file path
  if (sshOptions.privateKey && fs.existsSync(sshOptions.privateKey)) {
    try {
      sshOptions.privateKey = fs.readFileSync(sshOptions.privateKey, 'utf-8');
    } catch (err: any) {
      const errorMsg = `Failed to read private key file: ${err.message || err}`;
      console.error(pc.red(`Error: ${errorMsg}`));
      return { host, ip: sshOptions.host, success: false, error: errorMsg };
    }
  }

  try {
    let connected = false;
    while (!connected) {
      const spinner = ora(`Connecting to ${sshOptions.host} (alias: ${host})...`).start();
      try {
        await ssh.connect(sshOptions);
        spinner.succeed(pc.green(`Connected to ${sshOptions.host} successfully!`));
        connected = true;
      } catch (err: any) {
        spinner.stop();
        const errorMsg = err.message || '';
        if (
          errorMsg.toLowerCase().includes('passphrase') ||
          errorMsg.includes('Encrypted private key') ||
          errorMsg.includes('Cannot parse privateKey') ||
          errorMsg.includes('MAC mismatch')
        ) {
          const response = await prompts({
            type: 'password',
            name: 'passphrase',
            message: `Enter passphrase for ${host}:`
          });

          if (response.passphrase === undefined) {
            throw new Error('Deployment cancelled by user.');
          }

          sshOptions.passphrase = response.passphrase;
          cachedPassphrase = response.passphrase;
        } else {
          throw err;
        }
      }
    }

    // Execute steps
    if (config.steps && config.steps.length > 0) {
      for (const [index, step] of config.steps.entries()) {
        console.log(pc.blue(`\n[Step ${index + 1}/${config.steps.length}] Executing ${step.type}...`));

        if (step.type === 'upload') {
          await handleUploadStep(ssh, step as UploadStep);
        } else if (step.type === 'command') {
          await handleCommandStep(ssh, step as CommandStep);
        } else {
          console.warn(pc.yellow(`Unknown step type: ${(step as any).type}`));
        }
      }
    } else {
      console.log(pc.gray(`\nNo steps found in configuration, skipping...`));
    }

    console.log(pc.green(`\nDeployment to ${host} completed successfully!`));
    return { host, ip: sshOptions.host, success: true };

  } catch (error: any) {
    let errorMsg = error.message || String(error);
    if (error.errors) {
      console.error(pc.red(`\nDeployment to ${host} failed with multiple errors:`));
      error.errors.forEach((e: any) => {
        console.error(pc.red(` - ${e.message || e}`));
        if (e.stack) {
          console.error(pc.gray(e.stack));
        }
      });
      errorMsg = error.errors.map((e: any) => e.message || String(e)).join('; ');
    } else {
      console.error(pc.red(`\nDeployment to ${host} failed: ${errorMsg}`));
      if (error.stack) {
        console.error(pc.gray(error.stack));
      }
    }
    return { host, ip: sshOptions.host, success: false, error: errorMsg };
  } finally {
    ssh.dispose();
  }
}

async function handleUploadStep(ssh: NodeSSH, step: UploadStep) {
  const localPath = path.resolve(process.cwd(), step.local);
  const remotePath = step.remote;

  if (!fs.existsSync(localPath)) {
    console.warn(pc.yellow(`Warning: Local path ${localPath} does not exist, skipping...`));
    return;
  }

  const stat = fs.statSync(localPath);

  if (stat.isDirectory()) {
    const spinner = ora(`Uploading directory: ${step.local} -> ${step.remote}`).start();
    
    // Process pattern and ignore if provided
    if (step.pattern || step.ignore) {
      const searchPattern = step.pattern || '**/*';
      const files = await glob(searchPattern, {
        cwd: localPath,
        ignore: step.ignore,
        nodir: true,
        dot: true
      });

      spinner.text = `Found ${files.length} files matching pattern. Uploading...`;
      
      for (const file of files) {
        const fileLocalPath = path.join(localPath, file);
        // Normalize remote path for windows/linux differences
        const fileRemotePath = path.posix.join(remotePath, file.split(path.sep).join(path.posix.sep));
        
        spinner.text = `Uploading: ${file}`;
        // Ensure remote directory exists
        const remoteDir = path.posix.dirname(fileRemotePath);
        await ssh.execCommand(`mkdir -p ${remoteDir}`);
        await ssh.putFile(fileLocalPath, fileRemotePath);
      }
      spinner.succeed(pc.green(`Successfully uploaded ${files.length} files from ${step.local}`));
    } else {
      // Default behavior without glob
      await ssh.putDirectory(localPath, remotePath, {
        recursive: true,
        concurrency: 10,
        tick: (local, remote, error) => {
          if (error) {
            spinner.fail(pc.red(`Failed to upload ${local}: ${error.message}`));
            spinner.start(`Continuing upload...`);
          } else {
            spinner.text = `Uploading: ${local}`;
          }
        }
      });
      spinner.succeed(pc.green(`Successfully uploaded directory ${step.local}`));
    }
  } else {
    const spinner = ora(`Uploading file: ${step.local} -> ${step.remote}`).start();
    // Ensure remote directory exists for single file
    const remoteDir = path.posix.dirname(remotePath);
    await ssh.execCommand(`mkdir -p ${remoteDir}`);
    await ssh.putFile(localPath, remotePath);
    spinner.succeed(pc.green(`Successfully uploaded file ${step.local}`));
  }
}

async function handleCommandStep(ssh: NodeSSH, step: CommandStep) {
  const spinner = ora(`Executing: ${step.command}`).start();
  const result = await ssh.execCommand(step.command);
  
  if (result.code !== 0 && result.code !== null) {
    spinner.fail(pc.red(`Command failed with code ${result.code}: ${step.command}`));
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(pc.yellow(result.stderr));
    }
  } else {
    spinner.succeed(pc.green(`Command completed: ${step.command}`));
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(pc.yellow(result.stderr));
    }
  }
}