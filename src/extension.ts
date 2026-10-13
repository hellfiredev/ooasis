import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';
import { SessionStore } from './history/sessionStore';
import { getMaxSessions } from './config';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Ooasis');
  context.subscriptions.push(outputChannel);

  // Per-workspace storage; falls back to global storage when no folder is open
  const storageBase = context.storageUri ?? context.globalStorageUri;
  const sessionStore = new SessionStore(storageBase, getMaxSessions);
  const provider = new SidebarProvider(context.extensionUri, sessionStore, outputChannel);

  console.log('Local AI Agent extension activated!');

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('my-custom-ui-view', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Command: Ask AI about selected code (palette command)
  context.subscriptions.push(
    vscode.commands.registerCommand('first-extension.askAI', () => {
      vscode.commands.executeCommand('my-custom-ui-view.focus');
    })
  );
}

export function deactivate() {}
