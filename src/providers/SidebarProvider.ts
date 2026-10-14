import * as vscode from 'vscode';
import * as path from 'path';
import {
  ChatCompletionChunk,
  Message,
  ToolCall,
  ToolResultMessage,
  FileAttachment,
  WorkspaceFileItem,
  SessionFile,
  SessionMeta,
  ContentPart,
  WebviewLogLevel,
} from '../types/chat';
import { AGENT_TOOLS, ToolExecutor } from '../tools';
import { getApiHost, getMaxAgentIterations, getMaxContinuations } from '../config';
import { ConversationSummarizer } from '../summarizer';
import { DisplayLogBuilder } from '../history/displayLog';
import {
  SessionStore,
  generateSessionId,
  isValidSessionId,
  makeSessionTitle,
} from '../history/sessionStore';
import { sessionToMarkdown } from '../history/markdownExport';
import { shouldShowToolOutput } from '../history/toolVisibility';


export class SidebarProvider implements vscode.WebviewViewProvider {
  private _pendingTextToInsert?: string;
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

  // ─── Session persistence state ────────────────────────────────────────────
  /** Undefined until the first user message of a conversation */
  private _sessionId: string | undefined;
  private _sessionTitle = '';
  private _sessionCreatedAt = 0;
  private _displayLog = new DisplayLogBuilder();
  private _currentTurn: Promise<void> | null = null;
  private readonly _outputChannel: vscode.OutputChannel;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _sessionStore: SessionStore,
    outputChannel?: vscode.OutputChannel,
  ) {
    this._outputChannel = outputChannel ?? vscode.window.createOutputChannel('Ooasis');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._toolExecutor = new ToolExecutor(
      workspaceRoot,
      this._askUserConfirmation.bind(this)
    );

    this.initializeChat();

    this._setupFileWatcher();
    this._modelInfoPromise = this.updateModelInfo();
  }

  public addQuoteToInput(text: string) {
    if (this._webviewView) {
      this.postToWebview({ command: 'insertText', text });
    } else {
      this._pendingTextToInsert = this._pendingTextToInsert 
        ? this._pendingTextToInsert + '\n\n' + text 
        : text;
    }
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
      const res = await fetch(`${getApiHost()}/v1/models`);
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src ${webviewView.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webviewView.webview.cspSource}; worker-src ${webviewView.webview.cspSource} blob:; font-src ${webviewView.webview.cspSource}; img-src ${webviewView.webview.cspSource} data:;">
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
        case 'editChat':
          await this.handleEditChat(message.text, message.countFromEnd);
          break;
        case 'regenerateChat':
          await this.handleRegenerateChat(message.countFromEnd);
          break;
        case 'getWorkspaceFiles':
          await this.handleGetWorkspaceFiles();
          break;
        case 'attachMentionedFile':
          await this.handleAttachMentionedFile(message.fsPath);
          break;
        case 'openFile':
          if (typeof message.path === 'string' && message.path) {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const validation = this.validateOpenFilePath(message.path, workspaceRoot);
            if (!validation.allowed) {
              vscode.window.showErrorMessage(validation.error || 'Access denied.');
              break;
            }
            try {
              const uri = vscode.Uri.file(validation.absPath);
              const doc = await vscode.workspace.openTextDocument(uri);
              await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
            } catch {
              vscode.window.showErrorMessage(`Could not open file: ${message.path}`);
            }
          }
          break;
        case 'newChat':
          await this._stopAndWait();
          await this.initializeChat();
          this.postToWebview({ command: 'sessionCleared' });
          break;
        case 'listSessions':
          await this._sendSessionList();
          break;
        case 'loadSession':
          await this._loadSession(message.id);
          break;
        case 'deleteSession':
          await this._deleteSession(message.id);
          break;
        case 'exportSession':
          await this._exportSession(message.id);
          break;
        case 'stopGeneration':
          this._abortController?.abort();
          break;
        case 'webviewReady':
          this.postToWebview({
            command: 'modelInfo',
            info: { name: this._modelNameDisplay, contextWindow: this._activeContextWindow }
          });
          if (this._pendingTextToInsert) {
            this.postToWebview({ command: 'insertText', text: this._pendingTextToInsert });
            this._pendingTextToInsert = undefined;
          }
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
        case 'log':
          this.handleWebviewLog(message.level, message.text);
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
    this._sessionId = undefined;
    this._sessionTitle = '';
    this._sessionCreatedAt = 0;
    this._displayLog = new DisplayLogBuilder();
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
      const ext = path.extname(uri.fsPath).toLowerCase();

      let data: string | undefined;
      if (ext === '.pdf') {
        const rawBytes = await vscode.workspace.fs.readFile(uri);
        data = Buffer.from(rawBytes).toString('base64');
      }

      const attachment: FileAttachment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: fileName,
        fsPath: uri.fsPath,
        relativePath,
        size: stat.size,
        isBinary,
        data,
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

  private getMimeType(ext: string): string {
    const map: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
  }

  private async buildMessageContent(text: string, attachments?: FileAttachment[]): Promise<string | ContentPart[]> {
    if (!attachments || attachments.length === 0) {
      return text;
    }

    const parts: ContentPart[] = [{ type: 'text', text }];
    const MAX_BINARY_BYTES = 5 * 1024 * 1024; // 5 MB

    for (const att of attachments) {
      const uri = vscode.Uri.file(att.fsPath);
      const ext = path.extname(att.fsPath).toLowerCase();
      try {
        if (att.extractedText) {
          const formatted = `\n\n### Attached PDF File: \`${att.relativePath}\`\n\n${att.extractedText}`;
          parts.push({ type: 'text', text: formatted });
          continue;
        }

        if (!att.isBinary) {
          let formatted = `\n\n### Attached File: \`${att.relativePath}\``;
          formatted += ` (${this.formatBytes(att.size)})\n*(Note: File content is not provided. Use the \`read_file\` tool with the absolute path \`${att.fsPath}\` to read the file's content if needed.)*`;
          parts.push({ type: 'text', text: formatted });
        } else {
          if (att.size > MAX_BINARY_BYTES) {
            parts.push({ type: 'text', text: `\n\n### Attached File: \`${att.relativePath}\` (${this.formatBytes(att.size)})\n*(Note: Binary file exceeds size limit and was not sent.)*` });
            continue;
          }
          const rawBytes = await vscode.workspace.fs.readFile(uri);
          const base64 = Buffer.from(rawBytes).toString('base64');
          const mime = this.getMimeType(ext);

          if (mime.startsWith('image/') || mime.startsWith('video/')) {
            parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
          } else {
            parts.push({ type: 'file_url', file_url: { url: `data:${mime};base64,${base64}` } });
          }
        }
      } catch (err) {
        parts.push({ type: 'text', text: `\n*(Error reading file ${att.relativePath}: ${err instanceof Error ? err.message : String(err)})*` });
      }
    }

    return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
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
    const turn = this._runTurn(text, attachments);
    this._currentTurn = turn;
    try {
      await turn;
    } finally {
      if (this._currentTurn === turn) {
        this._currentTurn = null;
      }
    }
  }

  private async handleEditChat(
    newText: string,
    userTurnCountFromEnd: number
  ) {
    const turn = this._runEditTurn(newText, userTurnCountFromEnd);
    this._currentTurn = turn;
    try {
      await turn;
    } finally {
      if (this._currentTurn === turn) {
        this._currentTurn = null;
      }
    }
  }

  private async handleRegenerateChat(userTurnCountFromEnd: number) {
    const turn = this._runRegenerateTurn(userTurnCountFromEnd);
    this._currentTurn = turn;
    try {
      await turn;
    } finally {
      if (this._currentTurn === turn) {
        this._currentTurn = null;
      }
    }
  }

  private async _runTurn(
    text: string,
    attachments?: FileAttachment[]
  ) {
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    if (!this._sessionId) {
      this._sessionId = generateSessionId();
      this._sessionCreatedAt = Date.now();
      this._sessionTitle = makeSessionTitle(text);
    }
    this._displayLog.addUser(text, attachments?.map((a) => a.relativePath));

    try {
      const userContent = await this.buildMessageContent(text, attachments);

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
    } finally {
      // Persist after every turn — success, error, or stop
      await this._saveSession();
    }
  }

  private async _runEditTurn(newText: string, userTurnCountFromEnd: number) {
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // 1. Find dlIndex
    let c = 0;
    let dlIndex = -1;
    for (let i = this._displayLog.entries.length - 1; i >= 0; i--) {
      if (this._displayLog.entries[i].type === 'user') {
        if (c === userTurnCountFromEnd) {
          dlIndex = i;
          break;
        }
        c++;
      }
    }

    // 2. Find apiIndex
    c = 0;
    let apiIndex = -1;
    for (let i = this._chatHistory.length - 1; i >= 0; i--) {
      if (this._chatHistory[i].role === 'user') {
        if (c === userTurnCountFromEnd) {
          apiIndex = i;
          break;
        }
        c++;
      }
    }

    if (dlIndex === -1 || apiIndex === -1) {
      this.postToWebview({ command: 'agentError', text: 'Error: Could not find message to edit.' });
      return;
    }

    // 3. Extract original attachments and truncate histories
    const originalDlMsg = this._displayLog.entries[dlIndex];
    if (originalDlMsg.type !== 'user') {
      return;
    }
    const dlAttachments = originalDlMsg.attachments;
    this._displayLog.truncate(dlIndex);

    const originalApiMsg = this._chatHistory[apiIndex];
    const newUserContent = Array.isArray(originalApiMsg.content)
      ? [{ type: 'text', text: newText }, ...originalApiMsg.content.slice(1)] as ContentPart[]
      : newText;
    this._chatHistory.splice(apiIndex);

    // 4. Append new user message with preserved attachments
    this._displayLog.addUser(newText, dlAttachments);
    this._chatHistory.push({ role: 'user', content: newUserContent });

    // 5. Check summarization
    if (this._summarizer.shouldSummarize(this._totalUsedTokens, this._activeContextWindow)) {
      await this.performSummarization(signal);
    }
    if (signal.aborted) {
      this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
      return;
    }

    // 7. Update UI
    this.postToWebview({
      command: 'sessionRestored',
      sessionId: this._sessionId,
      entries: this._displayLog.entries,
      usage: { total_tokens: this._totalUsedTokens },
      contextWindow: this._activeContextWindow,
    });

    // 8. Run agent loop
    try {
      await this.runAgentLoop();
    } finally {
      await this._saveSession();
    }
  }

  private async _runRegenerateTurn(userTurnCountFromEnd: number) {
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // 1. Find dlIndex
    let c = 0;
    let dlIndex = -1;
    for (let i = this._displayLog.entries.length - 1; i >= 0; i--) {
      if (this._displayLog.entries[i].type === 'user') {
        if (c === userTurnCountFromEnd) {
          dlIndex = i;
          break;
        }
        c++;
      }
    }

    // 2. Find apiIndex
    c = 0;
    let apiIndex = -1;
    for (let i = this._chatHistory.length - 1; i >= 0; i--) {
      if (this._chatHistory[i].role === 'user') {
        if (c === userTurnCountFromEnd) {
          apiIndex = i;
          break;
        }
        c++;
      }
    }

    if (dlIndex === -1 || apiIndex === -1) {
      this.postToWebview({ command: 'agentError', text: 'Error: Could not find message to regenerate.' });
      return;
    }

    // 3. Truncate histories AFTER the user message
    this._displayLog.truncate(dlIndex + 1);
    this._chatHistory.splice(apiIndex + 1);

    // 4. Check summarization
    if (this._summarizer.shouldSummarize(this._totalUsedTokens, this._activeContextWindow)) {
      await this.performSummarization(signal);
    }
    if (signal.aborted) {
      this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
      return;
    }

    // 5. Update UI
    this.postToWebview({
      command: 'sessionRestored',
      sessionId: this._sessionId,
      entries: this._displayLog.entries,
      usage: { total_tokens: this._totalUsedTokens },
      contextWindow: this._activeContextWindow,
    });

    // 6. Run agent loop
    try {
      await this.runAgentLoop();
    } finally {
      await this._saveSession();
    }
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

      if (result.summary) {
        this.postToWebview({
          command: 'summaryCompleted',
          summary: result.summary,
        });
      }
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

    // Track continuations
    let continuationCount = 0;
    const maxContinuations = getMaxContinuations();
    const maxAgentIterations = getMaxAgentIterations();

    for (let iteration = 0; iteration < maxAgentIterations; iteration++) {
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

        const response = await fetch(`${getApiHost()}/v1/chat/completions`, {
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

        let reasoningTimeMs = undefined;
        if (hasReasoning && reasoningEndTime) {
          reasoningTimeMs = reasoningEndTime - reasoningStartTime;
        }

        // Finalize the current truncated assistant response as its own message
        this.postToWebview({
          command: 'finalizeStream',
          text: assistantContent || '*(Truncated)*',
          reasoning: assistantReasoning || undefined,
          reasoningTimeMs,
          done: false,
        });

        if (continuationCount > maxContinuations) {
          this._chatHistory.push({
            role: 'assistant',
            content: assistantContent || null,
            ...(assistantReasoning && { reasoning_content: assistantReasoning }),
          });
          this.postToWebview({
            command: 'agentError',
            text: 'Response reached maximum continuation limit.',
          });
          return;
        }

        // 1. Perform summarization first (compresses conversation up to current user turn)
        await this.performSummarization(signal, 'Context limit reached. Compressing context...');

        if (signal.aborted) {
          this.postToWebview({ command: 'finalizeStream', text: '*(Stopped)*', done: true });
          return;
        }

        // 2. Push the truncated assistant response to the history
        this._chatHistory.push({
          role: 'assistant',
          content: assistantContent || null,
          ...(assistantReasoning && { reasoning_content: assistantReasoning }),
        });

        // 3. Inject continuation prompt
        this._chatHistory.push({
          role: 'user',
          content: 'Please continue your response from where you left off.',
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
            text: assistantContent,
            reasoning: assistantReasoning,
            reasoningTimeMs,
            done: false,
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

          const isError =
            result.startsWith('Error:') ||
            result.startsWith('Error ') ||
            result.startsWith('Command denied by user') ||
            result.includes('\n\nERROR:') ||
            result.includes('ERROR: ');

          // Only run_terminal output is surfaced in the UI / saved log; the model
          // still receives the full result via toolResultMessages below.
          this.postToWebview({
            command: 'toolResult',
            toolCallId: tc.id,
            isError,
            ...(shouldShowToolOutput(tc.function.name) && { result }),
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
    this.postToWebview({
      command: 'agentError',
      text: `Agent reached maximum iterations (${maxAgentIterations}). Stopping.`,
    });
  }



  // ─── Session Persistence ──────────────────────────────────────────────────

  /**
   * Abort any in-flight turn and wait for it to finish (including its final
   * save) so a late save can never land in the wrong session.
   */
  private async _stopAndWait(): Promise<void> {
    this._abortController?.abort();
    // Unblock a turn waiting on a terminal confirmation
    for (const [, resolve] of this._pendingConfirmations) {
      resolve(false);
    }
    this._pendingConfirmations.clear();
    if (this._currentTurn) {
      try {
        await this._currentTurn;
      } catch {
        // Errors are already surfaced by the turn itself
      }
    }
  }

  /** Persist the current conversation. No-op until the first user message. */
  private async _saveSession(): Promise<void> {
    if (!this._sessionId) { return; }
    try {
      await this._sessionStore.save({
        version: 1,
        id: this._sessionId,
        title: this._sessionTitle || 'Untitled conversation',
        createdAt: this._sessionCreatedAt,
        updatedAt: Date.now(),
        messageCount: this._displayLog.userTurnCount,
        ...(this._modelNameDisplay && { model: this._modelNameDisplay }),
        totalUsedTokens: this._totalUsedTokens,
        // Snapshot: the write is queued, and history keeps mutating
        apiHistory: structuredClone(this._chatHistory),
        displayLog: structuredClone(this._displayLog.entries),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to save conversation:', err);
      vscode.window.showErrorMessage(`Ooasis: Failed to save conversation: ${msg}`);
    }
  }

  private async _sendSessionList(): Promise<void> {
    let sessions: SessionMeta[] = [];
    try {
      sessions = await this._sessionStore.list();
    } catch (err) {
      console.error('Failed to list conversations:', err);
    }
    this.postToWebview({
      command: 'sessionList',
      sessions,
      currentSessionId: this._sessionId,
    });
  }

  private async _loadSession(id: unknown): Promise<void> {
    if (!isValidSessionId(id)) { return; }

    await this._stopAndWait();

    let session: SessionFile | undefined;
    try {
      session = await this._sessionStore.load(id);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
    if (!session) {
      vscode.window.showErrorMessage('Ooasis: Conversation not found or unreadable.');
      await this._sendSessionList();
      return;
    }

    this._summarizer.reset();
    this._sessionId = session.id;
    this._sessionTitle = session.title;
    this._sessionCreatedAt = session.createdAt;
    this._totalUsedTokens = session.totalUsedTokens ?? 0;

    // Refresh the system prompt so resumed chats follow current SYSTEM.md / AGENTS.md
    const rest = session.apiHistory[0]?.role === 'system'
      ? session.apiHistory.slice(1)
      : session.apiHistory;
    this._chatHistory = [
      { role: 'system', content: await this.getSystemPrompt() },
      ...rest,
    ];
    this._displayLog = new DisplayLogBuilder(session.displayLog);

    this.postToWebview({
      command: 'sessionRestored',
      sessionId: session.id,
      entries: this._displayLog.entries,
      usage: { total_tokens: this._totalUsedTokens },
      contextWindow: this._activeContextWindow,
    });
  }

  private async _deleteSession(id: unknown): Promise<void> {
    if (!isValidSessionId(id)) { return; }

    let title = 'this conversation';
    try {
      const meta = (await this._sessionStore.list()).find((m) => m.id === id);
      if (meta) { title = `"${meta.title}"`; }
    } catch {
      // Fall back to generic title
    }

    const choice = await vscode.window.showWarningMessage(
      `Delete ${title}? This cannot be undone.`,
      { modal: true },
      'Delete'
    );
    if (choice !== 'Delete') { return; }

    const isCurrent = id === this._sessionId;
    if (isCurrent) {
      await this._stopAndWait();
    }

    try {
      await this._sessionStore.delete(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Ooasis: Failed to delete conversation: ${msg}`);
    }

    if (isCurrent) {
      await this.initializeChat();
      this.postToWebview({ command: 'sessionCleared' });
    }
    await this._sendSessionList();
  }

  private async _exportSession(id: unknown): Promise<void> {
    if (!isValidSessionId(id)) { return; }

    try {
      if (id === this._sessionId) {
        // Make sure the export includes the latest state
        await this._saveSession();
      }
      const session = await this._sessionStore.load(id);
      if (!session) {
        vscode.window.showErrorMessage('Ooasis: Conversation not found or unreadable.');
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: sessionToMarkdown(session),
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Ooasis: Failed to export conversation: ${msg}`);
    }
  }

  public handleWebviewLog(level: WebviewLogLevel, text: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[Webview][${(level || 'log').toUpperCase()}]`;
    const formatted = `${prefix} ${text ?? ''}`;

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'debug':
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
        break;
    }

    this._outputChannel.appendLine(`[${timestamp}] ${formatted}`);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private postToWebview(msg: Record<string, unknown>) {
    // Record transcript-relevant events (ignores everything else)
    this._displayLog.apply(msg);
    this._webviewView?.webview.postMessage(msg);
  }

  public validateOpenFilePath(filePath: string, workspaceRoot?: string): { allowed: boolean; absPath: string; error?: string } {
    if (!workspaceRoot) {
      return { allowed: false, absPath: '', error: 'No workspace open to view files.' };
    }
    const root = path.resolve(workspaceRoot);
    const absPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
    const rel = path.relative(root, absPath);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      return { allowed: false, absPath, error: `Access denied: path "${filePath}" is outside the workspace.` };
    }
    return { allowed: true, absPath };
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
