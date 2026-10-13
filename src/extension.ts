// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import dotenv from 'dotenv';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { ChatCompletionResponse } from './types/chat';

dotenv.config({ path: path.join(__dirname, '../.env') });

const API_HOST = process.env.API_HOST;

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

export class SidebarProvider implements vscode.WebviewViewProvider {
	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		webviewView.webview.options = {
			enableScripts: true, // Allow JavaScript in the UI
			localResourceRoots: [this._extensionUri]
		};

		// Create a secure URI to the compiled Tailwind CSS file
		const stylePath = vscode.Uri.joinPath(this._extensionUri, 'out', 'styles.css');
		const styleUri = webviewView.webview.asWebviewUri(stylePath);

		// Set the HTML content
		webviewView.webview.html = this.getHtmlContent(styleUri, webviewView.webview);

		// Listen for messages from the Webview
		webviewView.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'buttonClicked':
						// Trigger a native VS Code notification
						vscode.window.showInformationMessage(message.text);

						// Reply back to the Webview
						webviewView.webview.postMessage({
							command: 'updateStatus',
							text: 'The extension successfully received your message!'
						});
						return;

					case 'sendChat':
						fetch(`${API_HOST}/v1/chat/completions`, {
							method: "POST",
							headers: {
								"Content-Type": "application/json"
							},
							body: JSON.stringify({
								"model": "gemma-e4b",
								"messages": [{ "role": "user", "content": message.text }]
							})
						})
							.then(res => res.json())
							.then(data => {
								console.log("data:", data);
								const completionResponse = data as ChatCompletionResponse;
								const content = completionResponse.choices[0].message.content;
								const reasoning = completionResponse.choices[0].message.reasoning_content;

								console.log("Reasoning:", reasoning);
								console.log("Content:", content);

								return Promise.all([
									marked.parse(content),
									reasoning ? marked.parse(reasoning) : undefined,
								]);
							})
							.then(([parsedContent, parsedReasoning]) => {
								webviewView.webview.postMessage({
									command: 'receiveChat',
									text: DOMPurify.sanitize(parsedContent),
									reasoning: parsedReasoning ? DOMPurify.sanitize(parsedReasoning) : undefined,
								});
							})
							.catch(err => {
								console.error(err)
								webviewView.webview.postMessage({
									command: 'receiveChat',
									text: 'Error connecting to the AI model.'
								});
							});
						return;
				}
			}
		);
	}

	private getHtmlContent(styleUri: vscode.Uri, webview: vscode.Webview): string {
		const nonce = getNonce();

		return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <link href="${styleUri}" rel="stylesheet">
      <title>Chat UI</title>
    </head>
    <!-- body changed: bg-white, text-gray-900 -->
    <body class="h-screen flex flex-col bg-white text-gray-900 overflow-hidden m-0 p-0">
      
      <!-- Chat Messages List -->
      <div id="chat-container" class="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <!-- Initial system message: changed to bg-gray-100 and border-gray-200 -->
        <div class="bg-gray-100 border border-gray-200 p-3 rounded-lg self-start max-w-[85%] shadow-sm">
          <p class="text-sm">Hello! How can I help you today?</p>
        </div>
      </div>

      <!-- Input Area pinned to bottom: changed to bg-gray-50 and border-gray-200 -->
      <div class="p-3 bg-gray-50 border-t border-gray-200 flex gap-2">
        <input 
          type="text" 
          id="message-input" 
          class="flex-1 bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Type a message..."
        >
        <button 
          id="send-button" 
          class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          Send
        </button>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const input = document.getElementById('message-input');
        const button = document.getElementById('send-button');
        const chatContainer = document.getElementById('chat-container');

        function sendMessage() {
			const text = input.value.trim();
			if (!text) return;

			// 1. Disable input and button
			input.disabled = true;
			button.disabled = true;
			button.classList.add('opacity-50', 'cursor-not-allowed');

			// 2. Append user message
			const msgDiv = document.createElement('div');
			msgDiv.className = 'bg-blue-600 p-3 rounded-lg self-end max-w-[85%] shadow-sm text-white';
			msgDiv.innerHTML = \`<p class="text-sm">\${text}</p>\`;
			chatContainer.appendChild(msgDiv);

			// 3. Append Loading Indicator
			const loadingDiv = document.createElement('div');
			loadingDiv.id = 'loading-indicator'; // ID used to find and remove it later
			loadingDiv.className = 'bg-gray-100 border border-gray-200 p-3 rounded-lg self-start max-w-[85%] shadow-sm';
			
			// Tailwind's animate-pulse gives it a nice subtle fading effect
			loadingDiv.innerHTML = \`<p class="text-sm text-gray-500 animate-pulse">Thinking...</p>\`;

			chatContainer.appendChild(loadingDiv);
			chatContainer.scrollTop = chatContainer.scrollHeight;

			// 4. Send payload to extension.ts
			vscode.postMessage({ command: 'sendChat', text: text });

			// 5. Clear input
			input.value = '';
        }

        button.addEventListener('click', sendMessage);
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') sendMessage();
        });

        // Listen for replies from extension.ts
        window.addEventListener('message', event => {
          const message = event.data;
          
          if (message.command === 'receiveChat') {
			// 1. Remove the loading indicator
			const loader = document.getElementById('loading-indicator');
			if (loader) {
				loader.remove();
			}

			// 2. Re-enable input and button
			input.disabled = false;
			button.disabled = false;
			button.classList.remove('opacity-50', 'cursor-not-allowed');
			input.focus(); // Snap focus back to input

			// 3. Append the AI response
            const replyDiv = document.createElement('div');
            // Incoming replies aligned left: updated to bg-gray-100 and border-gray-200
            replyDiv.className = 'bg-gray-100 border border-gray-200 p-3 rounded-lg self-start max-w-[85%] shadow-sm flex flex-col gap-2';

			let innerHTML = '';

            // If reasoning content exists, display it as a simple indented block
			if (message.reasoning) {
			innerHTML += \`
				<div class="text-xs text-gray-500 italic border-l-2 border-gray-300 pl-2 whitespace-pre-line">\${message.reasoning.trim()}</div>
			\`;
			}
            
			// Add the main response content
			innerHTML += \`<div class="prose prose-sm prose-slate max-w-none">\${message.text}</div>\`;
			
			replyDiv.innerHTML = innerHTML;
			
			chatContainer.appendChild(replyDiv);
			chatContainer.scrollTop = chatContainer.scrollHeight;
          }
        });
      </script>
    </body>
    </html>
  `;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const provider = new SidebarProvider(context.extensionUri);
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "first-extension" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('first-extension.helloWorld', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		const res = await fetch('https://jsonplaceholder.typicode.com/todos/1')
		const data = await res.json();

		vscode.window.showInformationMessage(JSON.stringify(data));
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('my-custom-ui-view', provider)
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
