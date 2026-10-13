import * as vscode from 'vscode';
import * as path from 'path';
import {
  ChatCompletionChunk,
  Message,
  ToolCall,
  ToolResultMessage,
  FileAttachment,
  WorkspaceFileItem,
} from '../types/chat';
import { AGENT_TOOLS, ToolExecutor } from '../tools';
import { API_HOST, MAX_AGENT_ITERATIONS } from '../config';
import { ConversationSummarizer } from '../summarizer';


export class SidebarProvider implements vscode.WebviewViewProvider {
  private _chatHistory: (Message | ToolResultMessage)[] = [];
  private _toolExecutor: ToolExecutor;
  private _webviewView: vscode.WebviewView | undefined;
  private _watcher: vscode.FileSystemWatcher | undefined;
  private _workspaceFilesTimeout: ReturnType<typeof setTimeout> | null = null;
  private _activeContextWindow: number = 0;
  private _modelNameDisplay: string = '';
  private _modelInfoPromise: Promise<void>;
  private _abortController: AbortController | null = null;
  private _pendingConfirmations: Map<string, (result: boolean) => void> = new Map();
  private _totalUsedTokens: number = 0;
  private _summarizer = new ConversationSummarizer();

  constructor(private readonly _extensionUri: vscode.Uri) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._toolExecutor = new ToolExecutor(
      workspaceRoot,
      this._askUserConfirmation.bind(this)
    );

    this.initializeChat();

    this._setupFileWatcher();
    this._modelInfoPromise = this.updateModelInfo();
  }

  private _askUserConfirmation(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const id = Date.now().toString() + Math.random().toString();
      this._pendingConfirmations.set(id, resolve);
      this.postToWebview({
        command: 'askConfirmation',
        id,
        text: `The AI wants to run: ${command}`,
      });
    });
  }

  private async updateModelInfo() {
    try {
      const res = await fetch(`${API_HOST}/v1/models`);
      if (res.ok) {
        const json = await res.json() as any;
        const modelData = json.data?.[0];
        if (modelData) {
          if (modelData.meta?.n_ctx) {
            this._activeContextWindow = modelData.meta.n_ctx;
          }
          this._modelNameDisplay = modelData.id;
          if (this._webviewView) {
            this.postToWebview({
              command: 'modelInfo',
              info: { name: this._modelNameDisplay, contextWindow: this._activeContextWindow }
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch model info:', e);
    }
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    await this._modelInfoPromise;
    
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
          await this.initializeChat();
          break;
        case 'stopGeneration':
          this._abortController?.abort();
          break;
        case 'webviewReady':
          this.postToWebview({
            command: 'modelInfo',
            info: { name: this._modelNameDisplay, contextWindow: this._activeContextWindow }
          });
          break;
        case 'answerConfirmation':
          if (message.id && this._pendingConfirmations.has(message.id)) {
            const resolve = this._pendingConfirmations.get(message.id);
            if (resolve) {
              resolve(message.result === true);
            }
            this._pendingConfirmations.delete(message.id);
          }
          break;
      }
    });
  }

  // ─── File Attachment Handling ──────────────────────────────────────────────

  private async getSystemPrompt(): Promise<string> {
    let prompt = '';
    
    try {
      const systemMdPath = vscode.Uri.joinPath(this._extensionUri, 'SYSTEM.md');
      const systemRules = await vscode.workspace.fs.readFile(systemMdPath);
      prompt = Buffer.from(systemRules).toString('utf-8');
    } catch {
      // Fallback: auto-generate a minimal prompt from AGENT_TOOLS
      const toolList = AGENT_TOOLS
        .map(t => `- ${t.function.name}: ${t.function.description}`)
        .join('\n');
      prompt = `You have access to the following tools:\n\n${toolList}`;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (workspaceRoot) {
      const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');
      try {
        const uri = vscode.Uri.file(agentsMdPath);
        await vscode.workspace.fs.stat(uri);
        const customRules = await vscode.workspace.fs.readFile(uri);
        prompt += '\n\n# Workspace Rules (AGENTS.md)\n' + Buffer.from(customRules).toString('utf-8');
      } catch (err) {
        // Ignore if file doesn't exist
      }
    }
    
    return prompt;
  }

  private async initializeChat() {
    this._totalUsedTokens = 0;
    this._summarizer.reset();
    this._chatHistory = [{
      role: 'system',
      content: await this.getSystemPrompt(),
    }];
  }

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
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    let userContent = text;

    if (attachments && attachments.length > 0) {
      userContent += await this.formatAttachmentsForPrompt(attachments);
    }

    this._chatHistory.push({ role: 'user', content: userContent });

    // Check if context needs compression
    const shouldSummarize = this._summarizer.shouldSummarize(
      this._totalUsedTokens,
      this._activeContextWindow,
    );

    if (shouldSummarize) {
      await this.performSummarization(signal);
    }

    if (signal.aborted) {
      this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
      return;
    }

    // Run the agent loop
    await this.runAgentLoop();
  }

  // ─── Summarization ────────────────────────────────────────────────────────

  private async performSummarization(signal?: AbortSignal, customLoadingText?: string) {
    this.postToWebview({
      command: 'loadingMessage',
      text: customLoadingText || 'Conversation is too long, compressing context...',
    });

    try {
      const result = await this._summarizer.summarize(
        this._chatHistory,
        this._modelNameDisplay,
        signal
      );

      // summarized history has token usage count too
      this._chatHistory = result.trimmedHistory;
      this._totalUsedTokens = result.totalTokens; // Reset — next API call will refresh

      this.postToWebview({
        command: 'tokenUsage',
        usage: { total_tokens: result.totalTokens || this._totalUsedTokens },
        contextWindow: this._activeContextWindow
      });

      this.postToWebview({
        command: 'summaryCompleted',
        summary: result.summary,
      });
    } catch (err) {
      if (signal?.aborted) { return; }
      const msg = err instanceof Error ? err.message : String(err);
      this.postToWebview({
        command: 'agentError',
        text: `Context compression failed: ${msg}. Continuing with full history.`,
      });
    }
  }

  // ─── Agent Loop ───────────────────────────────────────────────────────────

  private async runAgentLoop() {
    if (!this._abortController) {
      this._abortController = new AbortController();
    }
    const { signal } = this._abortController;

    // Track accumulated text across truncation continuations
    let continuationBuffer = '';
    let continuationCount = 0;
    const MAX_CONTINUATIONS = 3;

    for (let iteration = 0; MAX_AGENT_ITERATIONS === -1 || iteration < MAX_AGENT_ITERATIONS; iteration++) {
      // Check if aborted before starting a new iteration
      if (signal.aborted) {
        this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
        return;
      }

      // Show streaming indicator
      this.postToWebview({
        command: 'agentThinking',
        iteration,
        text: continuationCount > 0 ? 'Continuing response...' : 'Thinking',
      });

      let assistantContent = '';
      let assistantReasoning = '';
      const pendingToolCalls: Map<number, ToolCall & { argumentsBuffer: string }> = new Map();
      let finishReason: string | null = null;
      let reasoningStartTime = Date.now();
      let reasoningEndTime: number | null = null;
      let hasReasoning = false;

      try {
        const apiMessages = this._chatHistory;
        console.debug("Chat history after summarized:", this._chatHistory);

        const response = await fetch(`${API_HOST}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            model: this._modelNameDisplay,
            messages: apiMessages,
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
            stream: true,
            stream_options: { include_usage: true },
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
              
              if (chunk.usage) {
                this._totalUsedTokens = chunk.usage.total_tokens;
                this.postToWebview({
                  command: 'tokenUsage',
                  usage: chunk.usage,
                  contextWindow: this._activeContextWindow
                });
              }

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
        if (signal.aborted) {
          this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
          return;
        }
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

      const isTruncated = finishReason === 'length' || finishReason === 'max_tokens';
      if (isTruncated) {
        continuationCount++;
        continuationBuffer += assistantContent;

        let reasoningTimeMs = undefined;
        if (hasReasoning && reasoningEndTime) {
          reasoningTimeMs = reasoningEndTime - reasoningStartTime;
        }

        if (continuationCount > MAX_CONTINUATIONS) {
          // Too many continuations — finalize with everything accumulated so far
          this.postToWebview({
            command: 'finalizeStream',
            text: continuationBuffer + '\n\n*(Response too long to continue further.)*',
            reasoning: assistantReasoning || undefined,
            reasoningTimeMs,
            done: true,
          });
          this._chatHistory.push({
            role: 'assistant',
            content: continuationBuffer,
          });
          return;
        }

        // 1. Perform summarization first with UI thinking indicator (compresses conversation up to current user turn)
        await this.performSummarization(signal, 'Context limit reached. Compressing context...');

        if (signal.aborted) {
          this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
          return;
        }

        // 2. Push the uncompressed partial assistant response to the summarized history
        this._chatHistory.push({
          role: 'assistant',
          content: assistantContent || null,
        });

        // 3. Inject a continuation prompt with strict guardrails so the model picks up where it left off
        const trailingSnippet = assistantContent.length > 150
          ? assistantContent.slice(-150)
          : assistantContent;

        const continuationPrompt = [
          'Your previous response was cut off mid-stream due to output/context limits.',
          ...(trailingSnippet ? [`Your output ended with:\n"""\n${trailingSnippet}\n"""`] : []),
          '',
          'STRICT CONTINUATION GUARDRAILS:',
          '1. SEAMLESS RESUMPTION: Begin your output IMMEDIATELY with the very next character or word required to complete the thought. Do not restart the cut-off sentence, item, or section.',
          '2. NO REPETITION OR REPHRASING: Do NOT repeat, rephrase, or summarize anything from your previous output.',
          '3. NO META HEADERS OR FILLER: Do NOT add "(Cont.)", "(Continued)", "Here is the rest", apologies, or conversational transitions.',
          '4. PRESERVE FORMATTING: Continue seamlessly with the exact same markdown structure, code block state, indentation, and list numbering.',
        ].join('\n');

        this._chatHistory.push({
          role: 'user',
          content: continuationPrompt,
        });

        continue;
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
            text: continuationBuffer + assistantContent,
            reasoning: assistantReasoning,
            reasoningTimeMs
          });
        }

        // Execute tools in parallel, then show results
        const toolResultMessages: ToolResultMessage[] = [];

        for (const tc of toolCalls) {
          // Check if aborted before each tool execution
          if (signal.aborted) {
            this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
            return;
          }

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

      // Merge any prior continuation chunks with the final segment
      const fullAssistantContent = continuationBuffer + assistantContent;

      this.postToWebview({
        command: 'finalizeStream',
        text: fullAssistantContent || '*(No response)*',
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
