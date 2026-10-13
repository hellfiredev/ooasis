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

export const DEFAULT_MAX_AGENT_ITERATIONS = 10;
export const DEFAULT_MAX_CONTINUATIONS = 3;

export function getMaxAgentIterations(): number {
  const config = vscode.workspace.getConfiguration('ooasis');
  const value = config.get<number>('maxAgentIterations');
  if (typeof value === 'number' && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_AGENT_ITERATIONS;
}

export function getMaxContinuations(): number {
  const config = vscode.workspace.getConfiguration('ooasis');
  const value = config.get<number>('maxContinuations');
  if (typeof value === 'number' && value >= 0) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_CONTINUATIONS;
}
