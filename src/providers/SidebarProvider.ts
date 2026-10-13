import * as vscode from 'vscode';
import * as path from 'path';
import {
  ChatCompletionResponse,
  ChatCompletionChunk,
  Message,
  ToolCall,
  ToolResultMessage,
  FileAttachment,
  WorkspaceFileItem,
} from '../types/chat';
import { AGENT_TOOLS, ToolExecutor } from '../tools';
import { API_HOST, MODEL_NAME, MAX_MESSAGES, KEEP_MESSAGES, MAX_AGENT_ITERATIONS, SYSTEM_PROMPT } from '../config';


export class SidebarProvider implements vscode.WebviewViewProvider {
  private _chatHistory: (Message | ToolResultMessage)[] = [];
  private _isSummarizing = false;
  private _toolExecutor: ToolExecutor;
  private _webviewView: vscode.WebviewView | undefined;
  private _watcher: vscode.FileSystemWatcher | undefined;
  private _workspaceFilesTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly _extensionUri: vscode.Uri) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._toolExecutor = new ToolExecutor(workspaceRoot);

    this._chatHistory.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });

    this._setupFileWatcher();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    const scriptUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist', 'assets', 'index.js'));
    const styleUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist', 'assets', 'index.css'));

    const nonce = this.getNonce();

    webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewView.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Local AI Agent</title>
  <link href="${styleUri}" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.MODEL_NAME = "${MODEL_NAME}";
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'sendChat':
          await this.handleUserMessage(message.text, message.attachments);
          break;
        case 'getWorkspaceFiles':
          await this.handleGetWorkspaceFiles();
          break;
        case 'attachMentionedFile':
          await this.handleAttachMentionedFile(message.fsPath);
          break;
        case 'newChat':
          this._chatHistory = [{
            role: 'system',
            content: SYSTEM_PROMPT,
          }];
          break;
      }
    });
  }

  // ─── File Attachment Handling ──────────────────────────────────────────────

  private _setupFileWatcher() {
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
    
    const isExcluded = (uri: vscode.Uri) => {
      const path = uri.fsPath.replace(/\\/g, '/');
      return path.includes('/node_modules/') || 
             path.includes('/.git/') || 
             path.includes('/out/') || 
             path.includes('/dist/') || 
             path.includes('/.vscode/');
    };

    this._watcher.onDidCreate((uri) => {
      if (!isExcluded(uri)) {
        this._triggerGetWorkspaceFiles();
      }
    });

    this._watcher.onDidDelete((uri) => {
      if (!isExcluded(uri)) {
        this._triggerGetWorkspaceFiles();
      }
    });
  }

  private _triggerGetWorkspaceFiles() {
    if (this._workspaceFilesTimeout) {
      clearTimeout(this._workspaceFilesTimeout);
    }
    this._workspaceFilesTimeout = setTimeout(() => {
      if (this._webviewView) {
        this.handleGetWorkspaceFiles();
      }
    }, 1000);
  }

  private async handleGetWorkspaceFiles() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.postToWebview({ command: 'workspaceFiles', files: [] });
      return;
    }

    const excludePattern = '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/.vscode/**}';
    const uris = await vscode.workspace.findFiles('**/*', excludePattern, 500);

    const files: WorkspaceFileItem[] = uris.map((uri) => ({
      name: path.basename(uri.fsPath),
      relativePath: vscode.workspace.asRelativePath(uri),
      fsPath: uri.fsPath,
    }));

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    this.postToWebview({ command: 'workspaceFiles', files });
  }

  private async handleAttachMentionedFile(fsPath: string) {
    if (!fsPath) {
      return;
    }
    try {
      const uri = vscode.Uri.file(fsPath);
      const stat = await vscode.workspace.fs.stat(uri);
      const fileName = path.basename(uri.fsPath);
      const relativePath = vscode.workspace.asRelativePath(uri);
      const isBinary = await this.isBinaryFile(uri, stat.size);

      const attachment: FileAttachment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: fileName,
        fsPath: uri.fsPath,
        relativePath,
        size: stat.size,
        isBinary,
      };

      this.postToWebview({
        command: 'filesAttached',
        files: [attachment],
      });
    } catch (err) {
      console.error('Failed to attach mentioned file:', fsPath, err);
    }
  }

  private async isBinaryFile(uri: vscode.Uri, size: number): Promise<boolean> {
    const binaryExtensions = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svgz',
      '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
      '.exe', '.dll', '.so', '.dylib', '.bin',
      '.woff', '.woff2', '.ttf', '.eot',
      '.mp3', '.mp4', '.mov', '.avi', '.wav',
    ]);
    const ext = path.extname(uri.fsPath).toLowerCase();
    if (binaryExtensions.has(ext)) {
      return true;
    }
    if (size === 0) {
      return false;
    }
    try {
      const buffer = await vscode.workspace.fs.readFile(uri);
      const sample = buffer.subarray(0, Math.min(512, buffer.length));
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) {
          return true;
        }
      }
    } catch {
      // Default to non-binary if unable to check
    }
    return false;
  }

  private async formatAttachmentsForPrompt(attachments: FileAttachment[]): Promise<string> {
    let formatted = '';
    const MAX_INLINE_BYTES = 50 * 1024; // 50 KB

    for (const att of attachments) {
      formatted += `\n\n### Attached File: \`${att.relativePath}\``;

      if (att.isBinary) {
        formatted += ` (${this.formatBytes(att.size)})\n*(Binary file attached. Use workspace tools if needed.)*`;
        continue;
      }

      try {
        const uri = vscode.Uri.file(att.fsPath);
        const rawBytes = await vscode.workspace.fs.readFile(uri);

        if (rawBytes.length <= MAX_INLINE_BYTES) {
          const text = Buffer.from(rawBytes).toString('utf-8');
          const lang = this.getLanguageId(att.name);
          formatted += ` (${this.formatBytes(att.size)})\n\`\`\`${lang}\n${text}\n\`\`\``;
        } else {
          const fullText = Buffer.from(rawBytes).toString('utf-8');
          const lines = fullText.split('\n');
          const truncatedLines = lines.slice(0, 500).join('\n');
          const lang = this.getLanguageId(att.name);
          formatted += ` (${this.formatBytes(att.size)} - Truncated: showing first 500 of ${lines.length} lines)\n\`\`\`${lang}\n${truncatedLines}\n\`\`\`\n*(Note: This file was truncated due to size. Use the \`read_file\` tool with start_line/end_line to inspect more.)*`;
        }
      } catch (err) {
        formatted += `\n*(Error reading file content: ${err instanceof Error ? err.message : String(err)})*`;
      }
    }

    return formatted;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private getLanguageId(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase().slice(1);
    const map: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      jsx: 'jsx',
      tsx: 'tsx',
      json: 'json',
      html: 'html',
      css: 'css',
      scss: 'scss',
      md: 'markdown',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      sh: 'bash',
      yaml: 'yaml',
      yml: 'yaml',
      sql: 'sql',
      xml: 'xml',
      toml: 'toml',
    };
    return map[ext] || ext || 'text';
  }

  // ─── Message Handling ─────────────────────────────────────────────────────

  private async handleUserMessage(
    text: string,
    attachments?: FileAttachment[]
  ) {
    let userContent = text;

    if (attachments && attachments.length > 0) {
      userContent += await this.formatAttachmentsForPrompt(attachments);
    }

    this._chatHistory.push({ role: 'user', content: userContent });

    // Summarize if needed
    const shouldSummarize = this._chatHistory.length > MAX_MESSAGES && !this._isSummarizing;
    if (shouldSummarize) {
      this.postToWebview({ command: 'loadingMessage', text: 'Compressing context...' });
    }

    await this.triggerBackgroundSummary(shouldSummarize);

    // Run the agent loop
    await this.runAgentLoop();
  }

  // ─── Agent Loop ───────────────────────────────────────────────────────────

  private async runAgentLoop() {
    for (let iteration = 0; MAX_AGENT_ITERATIONS === -1 || iteration < MAX_AGENT_ITERATIONS; iteration++) {
      // Show streaming indicator
      this.postToWebview({ command: 'agentThinking', iteration });

      let assistantContent = '';
      let assistantReasoning = '';
      const pendingToolCalls: Map<number, ToolCall & { argumentsBuffer: string }> = new Map();
      let finishReason: string | null = null;
      let reasoningStartTime = Date.now();
      let reasoningEndTime: number | null = null;
      let hasReasoning = false;

      try {
        const response = await fetch(`${API_HOST}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL_NAME,
            messages: this._chatHistory,
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
            stream: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('No response body for streaming');
        }

        // ── SSE Stream Processing ──────────────────────────────────────────
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) { break; }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) { continue; }
            const data = line.slice(6).trim();
            if (data === '[DONE]') { finishReason = finishReason ?? 'stop'; continue; }

            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              const delta = chunk.choices[0]?.delta;
              if (!delta) { continue; }

              if (chunk.choices[0].finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }

              // Accumulate text content
              if (delta.content) {
                if (hasReasoning && !reasoningEndTime) {reasoningEndTime = Date.now();}
                assistantContent += delta.content;
                this.postToWebview({ command: 'streamToken', token: delta.content });
              }

              // Accumulate reasoning
              if (delta.reasoning_content) {
                hasReasoning = true;
                assistantReasoning += delta.reasoning_content;
                this.postToWebview({ command: 'streamReasoning', token: delta.reasoning_content });
              }

              // Accumulate tool calls (streaming chunks have partial data)
              if (delta.tool_calls) {
                if (hasReasoning && !reasoningEndTime) {reasoningEndTime = Date.now();}
                for (const tc of delta.tool_calls) {
                  if (!pendingToolCalls.has(tc.index)) {
                    pendingToolCalls.set(tc.index, {
                      id: tc.id ?? '',
                      type: 'function',
                      function: { name: tc.function?.name ?? '', arguments: '' },
                      argumentsBuffer: '',
                    });
                  }
                  const existing = pendingToolCalls.get(tc.index)!;
                  if (tc.id) { existing.id = tc.id; }
                  if (tc.function?.name) { existing.function.name = tc.function.name; }
                  if (tc.function?.arguments) { existing.argumentsBuffer += tc.function.arguments; }
                }
              }
            } catch {
              // Ignore malformed chunks
            }
          }
        }
        
        if (hasReasoning && !reasoningEndTime) {
          reasoningEndTime = Date.now();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.postToWebview({ command: 'agentError', text: `Connection error: ${msg}` });
        return;
      }

      // Finalize tool calls arguments
      const toolCalls: ToolCall[] = [];
      for (const [, tc] of pendingToolCalls) {
        toolCalls.push({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.argumentsBuffer },
        });
      }

      // Push assistant message to history
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent || null,
        ...(assistantReasoning && { reasoning_content: assistantReasoning }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      };
      this._chatHistory.push(assistantMessage);

      // ── Case 1: Model wants to call tools ─────────────────────────────────
      if (toolCalls.length > 0) {
        // Finalize the streamed text before tool execution
        if (assistantContent || assistantReasoning) {
          let reasoningTimeMs = undefined;
          if (hasReasoning && reasoningEndTime) {
            reasoningTimeMs = reasoningEndTime - reasoningStartTime;
          }

          this.postToWebview({
            command: 'finalizeStream',
            text: assistantContent,
            reasoning: assistantReasoning,
            reasoningTimeMs
          });
        }

        // Execute tools in parallel, then show results
        const toolResultMessages: ToolResultMessage[] = [];

        for (const tc of toolCalls) {
          this.postToWebview({
            command: 'toolStart',
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: tc.function.arguments,
          });

          const result = await this._toolExecutor.execute(tc.function.name, tc.function.arguments);

          this.postToWebview({
            command: 'toolResult',
            toolCallId: tc.id,
            result,
          });

          toolResultMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
        }

        // Add tool results to history
        this._chatHistory.push(...toolResultMessages);

        // Continue the loop — model will now respond with tool results in context
        continue;
      }

      let reasoningTimeMs = undefined;
      if (hasReasoning && reasoningEndTime) {
        reasoningTimeMs = reasoningEndTime - reasoningStartTime;
      }

      this.postToWebview({
        command: 'finalizeStream',
        text: assistantContent || '*(No response)*',
        reasoning: assistantReasoning || undefined,
        reasoningTimeMs,
        done: true,
      });

      return;
    }

    // Exceeded max iterations
    if (MAX_AGENT_ITERATIONS !== -1) {
      this.postToWebview({
        command: 'agentError',
        text: `Agent reached maximum iterations (${MAX_AGENT_ITERATIONS}). Stopping.`,
      });
    }
  }

  // ─── Summarization ────────────────────────────────────────────────────────

  private async triggerBackgroundSummary(summarize: boolean) {
    if (!summarize) { return; }

    try {
      this._isSummarizing = true;

      const systemPrompt = this._chatHistory[0];
      const messagesToSummarize = this._chatHistory.slice(1, -1 * KEEP_MESSAGES);
      const summarizeCount = messagesToSummarize.length;

      const transcript = messagesToSummarize
        .map((msg) => `${msg.role.toUpperCase()}: ${(msg as Message).content ?? '[tool result]'}`)
        .join('\n\n');

      const summaryPrompt = `Summarize the following conversation concisely. Capture key technical details, file paths, decisions, and outcomes.\n\nTranscript:\n${transcript}`;

      const response = await fetch(`${API_HOST}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            { role: 'system', content: 'You are a technical summarizer.' },
            { role: 'user', content: summaryPrompt },
          ],
        }),
      });

      const data = (await response.json()) as ChatCompletionResponse;
      const summaryText = data.choices[0].message.content?.trim() ?? '';

      const retainedRecentMessages = this._chatHistory.slice(summarizeCount + 1);
      this._chatHistory = [
        systemPrompt,
        { role: 'system', content: `Summary of prior conversation: ${summaryText}` } as Message,
        ...retainedRecentMessages,
      ];
    } catch (err) {
      console.error('Summarization failed:', err);
    } finally {
      this._isSummarizing = false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private postToWebview(msg: Record<string, unknown>) {
    this._webviewView?.webview.postMessage(msg);
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
