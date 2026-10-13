import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new SidebarProvider(context.extensionUri);

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
