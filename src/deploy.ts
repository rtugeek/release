import { NodeSSH } from 'node-ssh';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import pc from 'picocolors';
import { glob } from 'glob';
import SSHConfig from 'ssh-config';
import prompts from 'prompts';
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

  console.log(pc.blue(`\nStarting deployment to ${hosts.length} host(s)...\n`));

  const results: DeployResult[] = [];

  for (const host of hosts) {
    console.log(pc.bgBlue(pc.white(`\n--- Deploying to ${host} ---`)));
    const result = await deployToHost(host, config);
    results.push(result);
    
    if (!result.success && options?.skipError === false) {
      console.log(pc.red(`\nDeployment to ${host} failed and --no-skip-error is set. Aborting remaining deployments.`));
      break;
    }
  }
  
  console.log(pc.green(`\nAll deployments completed!`));

  console.log(pc.blue('\nDeployment Summary:'));
  const tableData = results.map(r => ({
    Hostname: r.host,
    IP: r.ip,
    '运行结果': r.success ? '✅ Success' : '❌ Failed',
    '失败原因': r.error || '-'
  }));
  console.table(tableData);
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

  console.log('SSH CONFIG', sshOptions);

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
      try {
        console.log(pc.blue(`Connecting to ${sshOptions.host} (alias: ${host})...`));
        await ssh.connect(sshOptions);
        console.log(pc.green(`Connected to ${sshOptions.host} successfully!`));
        connected = true;
      } catch (err: any) {
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
    console.log(pc.cyan(`Uploading directory: ${step.local} -> ${step.remote}`));
    
    // Process pattern and ignore if provided
    if (step.pattern || step.ignore) {
      const searchPattern = step.pattern || '**/*';
      const files = await glob(searchPattern, {
        cwd: localPath,
        ignore: step.ignore,
        nodir: true,
        dot: true
      });

      console.log(pc.gray(`Found ${files.length} files matching pattern/ignore rules.`));
      
      for (const file of files) {
        const fileLocalPath = path.join(localPath, file);
        // Normalize remote path for windows/linux differences
        const fileRemotePath = path.posix.join(remotePath, file.split(path.sep).join(path.posix.sep));
        
        console.log(pc.gray(`  -> Uploading: ${file}`));
        // Ensure remote directory exists
        const remoteDir = path.posix.dirname(fileRemotePath);
        await ssh.execCommand(`mkdir -p ${remoteDir}`);
        await ssh.putFile(fileLocalPath, fileRemotePath);
      }
      console.log(pc.green(`Successfully uploaded ${files.length} files.`));
    } else {
      // Default behavior without glob
      await ssh.putDirectory(localPath, remotePath, {
        recursive: true,
        concurrency: 10,
        tick: (local, remote, error) => {
          if (error) {
            console.error(pc.red(`Failed to upload ${local}: ${error.message}`));
          }
        }
      });
      console.log(pc.green(`Successfully uploaded directory ${step.local}`));
    }
  } else {
    console.log(pc.cyan(`Uploading file: ${step.local} -> ${step.remote}`));
    // Ensure remote directory exists for single file
    const remoteDir = path.posix.dirname(remotePath);
    await ssh.execCommand(`mkdir -p ${remoteDir}`);
    await ssh.putFile(localPath, remotePath);
    console.log(pc.green(`Successfully uploaded file ${step.local}`));
  }
}

async function handleCommandStep(ssh: NodeSSH, step: CommandStep) {
  console.log(pc.cyan(`> ${step.command}`));
  const result = await ssh.execCommand(step.command);
  
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(pc.yellow(result.stderr));
  }
  if (result.code !== 0 && result.code !== null) {
    console.error(pc.red(`Command exited with code ${result.code}`));
  }
}