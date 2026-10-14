import * as vscode from 'vscode';

export function getApiHost(): string {
  const config = vscode.workspace.getConfiguration('ooasis');
  const value = config.get<string>('apiHost');
  if (!value || value.trim() === '') {
    throw new Error('Missing configuration. Please set ooasis.apiHost in VS Code Settings.');
  }
  return value.trim().replace(/\/+$/, '');
}

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

export const DEFAULT_MAX_SESSIONS = 100;

/** Maximum number of saved chat sessions per workspace. 0 = unlimited. */
export function getMaxSessions(): number {
  const config = vscode.workspace.getConfiguration('ooasis');
  const value = config.get<number>('history.maxSessions');
  if (typeof value === 'number' && value >= 0) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_SESSIONS;
}

export const DEFAULT_TERMINAL_SANDBOX_ENABLED = true;
export const DEFAULT_TERMINAL_SANDBOX_ALLOW_TEMP = false;

export function isTerminalSandboxEnabled(): boolean {
  try {
    const config = vscode.workspace.getConfiguration('ooasis');
    const value = config.get<boolean>('terminalSandbox.enabled');
    if (typeof value === 'boolean') {
      return value;
    }
    return DEFAULT_TERMINAL_SANDBOX_ENABLED;
  } catch {
    return DEFAULT_TERMINAL_SANDBOX_ENABLED;
  }
}

export function isTerminalSandboxAllowTemp(): boolean {
  try {
    const config = vscode.workspace.getConfiguration('ooasis');
    const value = config.get<boolean>('terminalSandbox.allowTempDirectory');
    if (typeof value === 'boolean') {
      return value;
    }
    return DEFAULT_TERMINAL_SANDBOX_ALLOW_TEMP;
  } catch {
    return DEFAULT_TERMINAL_SANDBOX_ALLOW_TEMP;
  }
}
