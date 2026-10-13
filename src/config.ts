import * as vscode from 'vscode';
import * as fs from 'fs';

function getRequiredConfig(configKey: string): string {
  const config = vscode.workspace.getConfiguration('ooasis');
  const configValue = config.get<string>(configKey);
  
  if (configValue && configValue.trim() !== '') {
    return configValue;
  }
  
  throw new Error(`Missing configuration. Please set ooasis.${configKey} in VS Code Settings.`);
}

export const API_HOST = getRequiredConfig('apiHost');
export const MODEL_NAME = getRequiredConfig('modelName');
export const MAX_MESSAGES = 20;
export const KEEP_MESSAGES = 4;
export const MAX_AGENT_ITERATIONS = 10;
export const SYSTEM_PROMPT = fs.readFileSync('SYSTEM.md', 'utf-8');
