export interface UploadStep {
  /**
   * 步骤类型，此处固定为 'upload'
   */
  type: 'upload';
  /**
   * 本地文件或目录的路径
   */
  local: string;
  /**
   * 远程目标路径
   */
  remote: string;
  /**
   * (可选) 匹配要上传文件的 glob 模式
   */
  pattern?: string;
  /**
   * (可选) 忽略上传的文件模式，支持字符串或字符串数组
   */
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