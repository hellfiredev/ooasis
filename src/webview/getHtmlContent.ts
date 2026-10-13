import * as vscode from 'vscode';
import { MODEL_NAME } from '../config';

export function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function getHtmlContent(styleUri: vscode.Uri, webview: vscode.Webview): string {
    const nonce = getNonce();
    return /* html */`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Local AI Agent</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #1e1e2e);
      --bg2: var(--vscode-input-background, #2a2a3d);
      --bg3: var(--vscode-editor-background, #181825);
      --border: var(--vscode-panel-border, #3c3c5a);
      --text: var(--vscode-foreground, #cdd6f4);
      --text-muted: var(--vscode-descriptionForeground, #6c7086);
      --accent: var(--vscode-button-background, #89b4fa);
      --accent-fg: var(--vscode-button-foreground, #1e1e2e);
      --user-bg: var(--vscode-button-background, #89b4fa);
      --user-fg: var(--vscode-button-foreground, #1e1e2e);
      --tool-bg: #2d2d44;
      --tool-border: #45475a;
      --success: #a6e3a1;
      --warning: #f9e2af;
      --error: #f38ba8;
      --radius: 8px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ── */
    #header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg3);
      flex-shrink: 0;
    }
    #header-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }
    #model-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg2);
      border: 1px solid var(--border);
      color: var(--text-muted);
      margin-left: auto;
    }

    /* ── Chat container ── */
    #chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    #chat-container::-webkit-scrollbar { width: 4px; }
    #chat-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    /* ── Messages ── */
    .msg-user {
      align-self: flex-end;
      background: var(--user-bg);
      color: var(--user-fg);
      padding: 8px 12px;
      border-radius: var(--radius) var(--radius) 2px var(--radius);
      max-width: 88%;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .msg-assistant {
      align-self: flex-start;
      max-width: 95%;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .msg-content {
      background: var(--bg2);
      border: 1px solid var(--border);
      padding: 10px 12px;
      border-radius: 2px var(--radius) var(--radius) var(--radius);
      line-height: 1.6;
      word-break: break-word;
    }
    .msg-content:empty { display: none; }

    /* Reasoning block */
    .msg-reasoning {
      border-left: 2px solid var(--border);
      padding: 6px 10px;
      font-size: 11px;
      color: var(--text-muted);
      font-style: italic;
      cursor: pointer;
      user-select: none;
    }
    .msg-reasoning summary {
      font-style: normal;
      font-weight: 600;
      color: var(--text-muted);
      list-style: none;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .msg-reasoning summary::before { content: '▶'; font-size: 9px; }
    .msg-reasoning[open] summary::before { content: '▼'; }
    .msg-reasoning .reasoning-body { margin-top: 6px; font-style: italic; }

    /* Prose styles for markdown */
    .msg-content h1, .msg-content h2, .msg-content h3 {
      font-size: 1em; font-weight: 600; margin: 8px 0 4px;
    }
    .msg-content p { margin: 4px 0; }
    .msg-content code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      background: var(--bg3);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .msg-content pre {
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px 10px;
      overflow-x: auto;
      margin: 6px 0;
    }
    .msg-content pre code { background: none; padding: 0; }
    .msg-content ul, .msg-content ol { padding-left: 18px; margin: 4px 0; }
    .msg-content li { margin: 2px 0; }
    .msg-content a { color: var(--accent); }

    /* ── Tool Call blocks ── */
    .tool-block {
      background: var(--tool-bg);
      border: 1px solid var(--tool-border);
      border-radius: var(--radius);
      overflow: hidden;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      max-width: 95%;
      align-self: flex-start;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(0,0,0,0.15);
      cursor: pointer;
      user-select: none;
    }
    .tool-icon { font-size: 12px; }
    .tool-name { font-weight: 600; color: var(--warning); }
    .tool-status {
      margin-left: auto;
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
    }
    .tool-status.running { background: #f9e2af33; color: var(--warning); }
    .tool-status.done { background: #a6e3a133; color: var(--success); }
    .tool-status.error { background: #f38ba833; color: var(--error); }
    .tool-body {
      padding: 8px 10px;
      display: none;
      max-height: 250px;
      overflow-y: auto;
    }
    .tool-block.open .tool-body { display: block; }
    .tool-args { color: var(--text-muted); margin-bottom: 6px; word-break: break-all; }
    .tool-result { color: var(--text); white-space: pre-wrap; word-break: break-word; }

    /* ── Loading / thinking indicator ── */
    .thinking-indicator {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 12px;
      padding: 6px 4px;
    }
    .thinking-dots {
      display: flex; gap: 3px;
    }
    .thinking-dots span {
      width: 5px; height: 5px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: pulse 1.4s ease-in-out infinite;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    /* ── Input area ── */
    #input-area {
      position: relative;
      padding: 8px 10px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
      background: var(--bg3);
    }
    #mention-dropdown {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 10px;
      right: 10px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      max-height: 240px;
      overflow-y: auto;
      z-index: 100;
      display: none;
      flex-direction: column;
    }
    #mention-dropdown::-webkit-scrollbar { width: 4px; }
    #mention-dropdown::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
    .mention-item {
      padding: 6px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text);
      transition: background-color 0.1s;
    }
    .mention-item:hover, .mention-item.active {
      background: var(--accent);
      color: var(--accent-fg);
    }
    .mention-item.attached {
      opacity: 0.65;
    }
    .mention-item.attached .mention-check {
      color: var(--accent);
      font-size: 11px;
      flex-shrink: 0;
    }
    .mention-item.attached:hover {
      opacity: 1;
      background: rgba(255, 80, 80, 0.15);
      color: var(--text);
    }
    .mention-item .mention-icon {
      font-size: 12px;
      flex-shrink: 0;
    }
    .mention-item .mention-name {
      font-weight: 600;
      font-family: var(--vscode-editor-font-family, monospace);
      flex-shrink: 0;
    }
    .mention-item .mention-path {
      font-size: 10px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-left: auto;
    }
    .mention-item:hover .mention-path, .mention-item.active .mention-path {
      color: var(--accent-fg);
      opacity: 0.85;
    }
    #attachments-tray {
      display: none;
      flex-wrap: wrap;
      gap: 6px;
      padding: 2px 0;
      max-height: 80px;
      overflow-y: auto;
    }
    #attachments-tray::-webkit-scrollbar { width: 4px; }
    #attachments-tray::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      color: var(--text);
      max-width: 100%;
    }
    .attachment-chip .chip-name {
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }
    .attachment-chip .chip-size {
      color: var(--text-muted);
      font-size: 10px;
    }
    .attachment-chip .chip-remove {
      cursor: pointer;
      color: var(--text-muted);
      margin-left: 2px;
      font-size: 13px;
      line-height: 1;
      border: none;
      background: transparent;
      padding: 0 2px;
    }
    .attachment-chip .chip-remove:hover {
      color: var(--error);
    }
    #input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }
    #message-input {
      flex: 1;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 7px 10px;
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      min-height: 36px;
      max-height: 120px;
      outline: none;
      line-height: 1.4;
      transition: border-color 0.15s;
    }
    #message-input:focus { border-color: var(--accent); }
    #message-input::placeholder { color: var(--text-muted); }

    #send-button {
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      border-radius: var(--radius);
      padding: 7px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      height: 36px;
      white-space: nowrap;
    }
    #send-button:hover { opacity: 0.85; }
    #send-button:disabled { opacity: 0.4; cursor: not-allowed; }

    #hint-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .hint-text {
      font-size: 10px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div id="header">
    <span id="header-title">⚡ Local AI Agent</span>
    <span id="model-badge">${MODEL_NAME}</span>
  </div>

  <!-- Chat messages -->
  <div id="chat-container"></div>

  <!-- Input area -->
  <div id="input-area">
    <div id="mention-dropdown"></div>
    <div id="attachments-tray"></div>
    <div id="input-row">
      <textarea
        id="message-input"
        placeholder="Ask anything... (@ to attach file)"
        rows="1"
      ></textarea>
      <button id="send-button">Send</button>
    </div>
    <div id="hint-row">
      <span class="hint-text">Enter to send · Type @ to attach file</span>
    </div>
  </div>

<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();
  const input = document.getElementById('message-input');
  const button = document.getElementById('send-button');
  const attachmentsTray = document.getElementById('attachments-tray');
  const mentionDropdown = document.getElementById('mention-dropdown');
  const chatContainer = document.getElementById('chat-container');

  let attachedFiles = [];
  let workspaceFiles = [];
  let mentionVisible = false;
  let mentionQuery = '';
  let mentionStartIndex = -1;
  let mentionSelectedIndex = 0;
  let filteredMentionFiles = [];
  let streamingDiv = null; // The current streaming message div
  let streamingContent = '';
  let streamingReasoning = '';
  let thinkingDiv = null;

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderAttachments() {
    attachmentsTray.innerHTML = '';
    if (attachedFiles.length === 0) {
      attachmentsTray.style.display = 'none';
      return;
    }
    attachmentsTray.style.display = 'flex';
    attachedFiles.forEach(file => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';

      const icon = document.createElement('span');
      icon.textContent = file.isBinary ? '📦' : '📄';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'chip-name';
      nameSpan.textContent = file.name;
      nameSpan.title = file.relativePath;

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'chip-size';
      sizeSpan.textContent = formatBytes(file.size);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove attachment';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        attachedFiles = attachedFiles.filter(f => f.id !== file.id);
        renderAttachments();
      };

      chip.appendChild(icon);
      chip.appendChild(nameSpan);
      chip.appendChild(sizeSpan);
      chip.appendChild(removeBtn);
      attachmentsTray.appendChild(chip);
    });
  }

  // ── Mention Autocomplete ──────────────────────────────────────────────────
  function fetchWorkspaceFiles() {
    vscodeApi.postMessage({ command: 'getWorkspaceFiles' });
  }
  fetchWorkspaceFiles();

  function showMentionDropdown() {
    if (workspaceFiles.length === 0) {
      fetchWorkspaceFiles();
    }
    mentionVisible = true;
    mentionSelectedIndex = 0;
    updateMentionDropdown();
  }

  function hideMentionDropdown() {
    mentionVisible = false;
    mentionDropdown.style.display = 'none';
    mentionDropdown.innerHTML = '';
    mentionStartIndex = -1;
    mentionQuery = '';
    filteredMentionFiles = [];
    mentionSelectedIndex = 0;
  }

  function scrollActiveItemIntoView() {
    const items = mentionDropdown.querySelectorAll('.mention-item:not(.attached)');
    if (items[mentionSelectedIndex]) {
      items[mentionSelectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function updateMentionSelection() {
    const items = mentionDropdown.querySelectorAll('.mention-item:not(.attached)');
    items.forEach((item, idx) => {
      if (idx === mentionSelectedIndex) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    scrollActiveItemIntoView();
  }

  function isFileAttached(file) {
    return attachedFiles.some(a => a.fsPath === file.fsPath);
  }

  function updateMentionDropdown() {
    if (!mentionVisible) return;

    if (workspaceFiles.length === 0) {
      mentionDropdown.style.display = 'none';
      return;
    }

    const q = mentionQuery.toLowerCase();
    const allMatching = workspaceFiles.filter(f =>
      f.name.toLowerCase().includes(q) || f.relativePath.toLowerCase().includes(q)
    );

    if (allMatching.length === 0) {
      hideMentionDropdown();
      return;
    }

    // Sort: unattached first, then attached; within each group, prefix matches first
    const attachedSet = new Set();
    allMatching.forEach(f => { if (isFileAttached(f)) attachedSet.add(f.fsPath); });

    allMatching.sort((a, b) => {
      const aAtt = attachedSet.has(a.fsPath);
      const bAtt = attachedSet.has(b.fsPath);
      if (aAtt !== bAtt) return aAtt ? 1 : -1;
      const aStarts = a.name.toLowerCase().startsWith(q);
      const bStarts = b.name.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.relativePath.localeCompare(b.relativePath);
    });

    const displayFiles = allMatching.slice(0, 25);
    // filteredMentionFiles only contains selectable (unattached) items for keyboard nav
    filteredMentionFiles = displayFiles.filter(f => !attachedSet.has(f.fsPath));

    if (displayFiles.length === 0) {
      hideMentionDropdown();
      return;
    }

    mentionDropdown.innerHTML = '';

    let selectableIdx = 0;
    displayFiles.forEach((file) => {
      const alreadyAttached = attachedSet.has(file.fsPath);
      const item = document.createElement('div');

      if (alreadyAttached) {
        item.className = 'mention-item attached';
      } else {
        item.className = 'mention-item' + (selectableIdx === mentionSelectedIndex ? ' active' : '');
        selectableIdx++;
      }

      if (alreadyAttached) {
        const checkSpan = document.createElement('span');
        checkSpan.className = 'mention-check';
        checkSpan.textContent = '✓';
        item.appendChild(checkSpan);
      }

      const iconSpan = document.createElement('span');
      iconSpan.className = 'mention-icon';
      iconSpan.textContent = '📄';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'mention-name';
      nameSpan.textContent = file.name;

      const pathSpan = document.createElement('span');
      pathSpan.className = 'mention-path';
      pathSpan.textContent = file.relativePath;

      item.appendChild(iconSpan);
      item.appendChild(nameSpan);
      item.appendChild(pathSpan);

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (alreadyAttached) {
          removeAttachedFile(file);
        } else {
          selectMentionFile(file);
        }
      });

      mentionDropdown.appendChild(item);
    });

    mentionDropdown.style.display = 'flex';
  }

  function removeAttachedFile(file) {
    attachedFiles = attachedFiles.filter(f => f.fsPath !== file.fsPath);
    renderAttachments();

    // Remove @filename from input text
    const mentionPattern = '@' + file.name;
    const idx = input.value.indexOf(mentionPattern);
    if (idx !== -1) {
      let endIdx = idx + mentionPattern.length;
      if (input.value[endIdx] === ' ') endIdx++;
      input.value = input.value.slice(0, idx) + input.value.slice(endIdx);
    }

    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';

    hideMentionDropdown();
    input.focus();
  }

  function selectMentionFile(file) {
    const mentionText = '@' + file.name + ' ';

    // Replace the @query with @filename
    const startIdx = mentionStartIndex >= 0 ? mentionStartIndex : input.value.lastIndexOf('@');
    const queryLen = mentionQuery ? mentionQuery.length : 0;
    const endIdx = startIdx >= 0 ? startIdx + 1 + queryLen : (input.selectionStart || 0);

    const beforeAt = startIdx >= 0 ? input.value.slice(0, startIdx) : '';
    const afterMention = endIdx <= input.value.length ? input.value.slice(endIdx) : '';

    input.value = beforeAt + mentionText + afterMention;
    const newCursorPos = beforeAt.length + mentionText.length;

    hideMentionDropdown();

    input.focus();
    input.setSelectionRange(newCursorPos, newCursorPos);

    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';

    // Attach file to conversation
    vscodeApi.postMessage({
      command: 'attachMentionedFile',
      fsPath: file.fsPath
    });
  }

  function checkMentionTrigger() {
    const cursorPos = input.selectionStart;
    const textBeforeCursor = input.value.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(^|\s)@([^\s]*)$/);

    if (match) {
      mentionStartIndex = textBeforeCursor.length - match[2].length - 1;
      mentionQuery = match[2];
      showMentionDropdown();
    } else {
      hideMentionDropdown();
    }
  }

  // ── Auto-resize textarea & mention check ──────────────────────────────────
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    checkMentionTrigger();
  });

  document.addEventListener('click', (e) => {
    if (!mentionDropdown.contains(e.target)) {
      hideMentionDropdown();
    }
  });

  // ── Send message ──────────────────────────────────────────────────────────
  function sendMessage() {
    const text = input.value.trim();
    if (!text && attachedFiles.length === 0) return;
    if (button.disabled) return;

    hideMentionDropdown();

    // Disable input
    input.disabled = true;
    button.disabled = true;

    // Append user message
    const userDiv = document.createElement('div');
    userDiv.className = 'msg-user';
    userDiv.textContent = text || 'Please review the attached file(s).';
    chatContainer.appendChild(userDiv);

    // Show thinking indicator
    showThinking('Thinking...');

    const filesToSend = [...attachedFiles];
    attachedFiles = [];
    renderAttachments();

    vscodeApi.postMessage({
      command: 'sendChat',
      text: text || 'Please review the attached file(s).',
      attachments: filesToSend
    });
    input.value = '';
    input.style.height = 'auto';
    scrollBottom();
  }

  button.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (mentionVisible && filteredMentionFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionSelectedIndex = (mentionSelectedIndex + 1) % filteredMentionFiles.length;
        updateMentionSelection();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionSelectedIndex = (mentionSelectedIndex - 1 + filteredMentionFiles.length) % filteredMentionFiles.length;
        updateMentionSelection();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMentionFile(filteredMentionFiles[mentionSelectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideMentionDropdown();
        return;
      }
    } else if (mentionVisible && e.key === 'Escape') {
      e.preventDefault();
      hideMentionDropdown();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Thinking indicator ────────────────────────────────────────────────────
  function showThinking(label) {
    removeThinking();
    thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking-indicator';
    thinkingDiv.id = 'thinking-indicator';
    thinkingDiv.innerHTML = \`
      <div class="thinking-dots">
        <span></span><span></span><span></span>
      </div>
      <span id="thinking-label">\${label}</span>
    \`;
    chatContainer.appendChild(thinkingDiv);
    scrollBottom();
  }

  function removeThinking() {
    const el = document.getElementById('thinking-indicator');
    if (el) el.remove();
    thinkingDiv = null;
  }

  function updateThinking(label) {
    const el = document.getElementById('thinking-label');
    if (el) el.textContent = label;
  }

  // ── Streaming helpers ─────────────────────────────────────────────────────
  function getOrCreateStreamDiv() {
    if (streamingDiv) return streamingDiv;

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-assistant';
    wrapper.id = 'streaming-msg';

    streamingDiv = wrapper;
    chatContainer.appendChild(wrapper);
    scrollBottom();
    return wrapper;
  }

  function getOrCreateStreamContent() {
    const wrapper = getOrCreateStreamDiv();
    let contentEl = wrapper.querySelector('.msg-content');
    if (!contentEl) {
      contentEl = document.createElement('div');
      contentEl.className = 'msg-content';
      wrapper.appendChild(contentEl);
    }
    return contentEl;
  }

  function getOrCreateReasoningEl() {
    const wrapper = getOrCreateStreamDiv();
    let el = wrapper.querySelector('.msg-reasoning');
    if (!el) {
      el = document.createElement('details');
      el.className = 'msg-reasoning';
      el.innerHTML = '<summary>Thinking</summary><div class="reasoning-body"></div>';
      wrapper.insertBefore(el, wrapper.firstChild);
    }
    return el;
  }

  // ── Tool block helpers ────────────────────────────────────────────────────
  const toolBlocks = {};

  function createToolBlock(toolCallId, toolName, argsJson) {
    let args = '';
    try {
      const parsed = JSON.parse(argsJson);
      args = JSON.stringify(parsed, null, 2);
    } catch { args = argsJson; }

    const block = document.createElement('div');
    block.className = 'tool-block open';
    block.id = 'tool-' + toolCallId;
    block.innerHTML = \`
      <div class="tool-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">\${toolName}</span>
        <span class="tool-status running" id="tool-status-\${toolCallId}">running</span>
      </div>
      <div class="tool-body">
        <div class="tool-args">\${args}</div>
        <div class="tool-result" id="tool-result-\${toolCallId}">…</div>
      </div>
    \`;
    chatContainer.appendChild(block);
    toolBlocks[toolCallId] = block;
    scrollBottom();
    return block;
  }

  function updateToolResult(toolCallId, result, isError) {
    const statusEl = document.getElementById('tool-status-' + toolCallId);
    const resultEl = document.getElementById('tool-result-' + toolCallId);
    if (statusEl) {
      statusEl.textContent = isError ? 'error' : 'done';
      statusEl.className = 'tool-status ' + (isError ? 'error' : 'done');
    }
    if (resultEl) {
      resultEl.textContent = result;
    }
    // Auto-collapse tool blocks after completion
    const block = document.getElementById('tool-' + toolCallId);
    if (block) {
      setTimeout(() => block.classList.remove('open'), 800);
    }
  }

  // ── Message handler ───────────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;

    switch (msg.command) {
      case 'agentThinking': {
        removeThinking();
        if (msg.iteration === 0) {
          // Fresh start — clear previous streaming state
          streamingDiv = null;
          streamingContent = '';
          streamingReasoning = '';
        }
        showThinking(msg.iteration === 0 ? 'Thinking...' : 'Continuing...');
        break;
      }

      case 'streamToken': {
        removeThinking();
        streamingContent += msg.token;
        const el = getOrCreateStreamContent();
        el.textContent = streamingContent; // raw text while streaming
        scrollBottom();
        break;
      }

      case 'streamReasoning': {
        streamingReasoning += msg.token;
        const el = getOrCreateReasoningEl();
        el.querySelector('.reasoning-body').textContent = streamingReasoning;
        break;
      }

      case 'toolStart': {
        removeThinking();
        createToolBlock(msg.toolCallId, msg.toolName, msg.args);
        showThinking('Running ' + msg.toolName + '...');
        break;
      }

      case 'toolResult': {
        updateToolResult(msg.toolCallId, msg.result, msg.result?.startsWith('Error'));
        removeThinking();
        break;
      }

      case 'loadingMessage': {
        updateThinking(msg.text);
        break;
      }

      case 'filesAttached': {
        if (Array.isArray(msg.files)) {
          for (const f of msg.files) {
            if (!attachedFiles.some(existing => existing.fsPath === f.fsPath)) {
              attachedFiles.push(f);
            }
          }
          renderAttachments();
        }
        break;
      }

      case 'workspaceFiles': {
        workspaceFiles = msg.files || [];
        if (mentionVisible) {
          updateMentionDropdown();
        }
        break;
      }

      case 'finalizeStream': {
        removeThinking();

        // Set final rendered HTML on the content element
        const wrapper = getOrCreateStreamDiv();
        wrapper.removeAttribute('id');

        let contentEl = wrapper.querySelector('.msg-content');
        if (!contentEl) {
          contentEl = document.createElement('div');
          contentEl.className = 'msg-content';
          wrapper.appendChild(contentEl);
        }
        contentEl.innerHTML = msg.text || '';

        // Update reasoning if present
        if (msg.reasoning) {
          let reasonEl = wrapper.querySelector('.msg-reasoning');
          if (!reasonEl) {
            reasonEl = document.createElement('details');
            reasonEl.className = 'msg-reasoning';
            wrapper.insertBefore(reasonEl, wrapper.firstChild);
          }
          reasonEl.innerHTML = \`<summary>Thinking</summary><div class="reasoning-body">\${msg.reasoning}</div>\`;
        }

        if (msg.done) {
          // Reset streaming state for next message
          streamingDiv = null;
          streamingContent = '';
          streamingReasoning = '';

          // Re-enable input
          input.disabled = false;
          button.disabled = false;
          input.focus();
        }

        scrollBottom();
        break;
      }

      case 'agentError': {
        removeThinking();
        const errDiv = document.createElement('div');
        errDiv.className = 'msg-assistant';
        errDiv.innerHTML = \`<div class="msg-content" style="color:var(--error);">⚠️ \${msg.text}</div>\`;
        chatContainer.appendChild(errDiv);

        input.disabled = false;
        button.disabled = false;
        input.focus();

        // Reset streaming state
        streamingDiv = null;
        streamingContent = '';
        streamingReasoning = '';
        scrollBottom();
        break;
      }
    }
  });

  function scrollBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
</script>

</body>
</html>
`;
}
