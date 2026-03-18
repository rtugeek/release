export interface UploadStep {
  type: 'upload';
  local: string;
  remote: string;
  pattern?: string;
  ignore?: string | string[];
}

export interface CommandStep {
  type: 'command';
  command: string;
}

export type Step = UploadStep | CommandStep;

export interface DeployConfig {
  host: string | string[];
  port?: number;
  username?: string; // made optional since it could be read from ~/.ssh/config
  password?: string;
  privateKey?: string;
  passphrase?: string;
  steps?: Step[];
}