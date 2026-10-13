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

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('my-custom-ui-view', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Command: Ask AI about selected code (palette command)
  context.subscriptions.push(
    vscode.commands.registerCommand('first-extension.askAI', () => {
      vscode.commands.executeCommand('my-custom-ui-view.focus');

      const editor = vscode.window.activeTextEditor;
      if (editor && !editor.selection.isEmpty) {
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        const fileName = vscode.workspace.asRelativePath(editor.document.uri);
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const langId = editor.document.languageId;

        const quote = `\`\`\`${langId}\n// ${fileName} (lines ${startLine}-${endLine})\n${text}\n\`\`\``;
        provider.addQuoteToInput(quote);
      }
    })
  );
}

export function deactivate() {}
