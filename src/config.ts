import * as vscode from 'vscode';

function getRequiredConfig(configKey: string): string {
  const config = vscode.workspace.getConfiguration('ooasis');
  const configValue = config.get<string>(configKey);
  
  if (configValue && configValue.trim() !== '') {
    return configValue;
  }
  
  throw new Error(`Missing configuration. Please set ooasis.${configKey} in VS Code Settings.`);
}

export const API_HOST = getRequiredConfig('apiHost');
export const MAX_MESSAGES = 20;
export const KEEP_MESSAGES = 4;
export const MAX_AGENT_ITERATIONS: number = -1;
