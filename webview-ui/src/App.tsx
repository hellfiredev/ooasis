import { useState, useEffect, useRef } from 'react';
import { vscode } from './vscodeApi';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';
import { PDFParse } from 'pdf-parse';
import pdfWorkerText from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import 'katex/dist/katex.min.css';
import './index.css';

try {
  const blob = new Blob([pdfWorkerText], { type: 'application/javascript' });
  PDFParse.setWorker(URL.createObjectURL(blob));
} catch (e) {
  console.error('Failed to initialize PDF worker:', e);
}

marked.use(markedKatex({ throwOnError: false }));

interface FileAttachment {
  id: string;
  name: string;
  fsPath: string;
  relativePath: string;
  size: number;
  isBinary: boolean;
  data?: string;
  extractedText?: string;
}

async function extractPdfText(base64Data: string): Promise<string> {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

interface WorkspaceFileItem {
  name: string;
  relativePath: string;
  fsPath: string;
}

interface ToolCall {
  id: string;
  name: string;
  args: string;
  result?: string;
  status: 'running' | 'done' | 'error';
  open?: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  reasoning?: string;
  reasoningTimeMs?: number;
  toolCalls?: ToolCall[];
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatK(num: number) {
  if (num >= 1000) {
    return Math.floor(num / 1000) + 'K';
  }
  return num.toString();
}

interface ConfirmationRequest {
  id: string;
  text: string;
}

interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model?: string;
}

type DisplayEntry =
  | { type: 'user'; text: string; attachments?: string[]; timestamp: number }
  | {
      type: 'assistant';
      text: string;
      reasoning?: string;
      reasoningTimeMs?: number;
      toolCalls?: { id: string; name: string; args: string; result?: string }[];
      timestamp: number;
    }
  | { type: 'error'; text: string; timestamp: number }
  | { type: 'summary'; text: string; timestamp: number };

const safeSanitize = (html: string) => DOMPurify.sanitize(html, {
  ADD_TAGS: ['math', 'annotation', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'mfrac', 'mstyle', 'mphantom', 'mtable', 'mtr', 'mtd', 'mpadded', 'msqrt', 'menclose', 'munder', 'mover', 'munderover'],
  ADD_ATTR: ['class', 'style', 'xmlns']
}) as string;

const renderMd = (text: string) => safeSanitize(marked.parse(text) as string);

const newMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const errorHtml = (text: string) => `<div class="error">${text}</div>`;

const summaryHtml = (summary: string) =>
  `<div class="summary-block"><strong>Context Compressed</strong>${renderMd(summary)}</div>`;

/** Convert a persisted transcript into renderable chat messages. */
function entriesToMessages(entries: DisplayEntry[]): ChatMessage[] {
  return entries.map((entry): ChatMessage => {
    switch (entry.type) {
      case 'user':
        return { id: newMessageId(), role: 'user', content: entry.text };
      case 'assistant':
        return {
          id: newMessageId(),
          role: 'assistant',
          content: entry.text ? renderMd(entry.text) : '',
          reasoning: entry.reasoning ? renderMd(entry.reasoning) : undefined,
          reasoningTimeMs: entry.reasoningTimeMs,
          toolCalls: entry.toolCalls?.map(tc => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
            result: tc.result,
            status: 'done' as const,
            open: false,
          })),
        };
      case 'error':
        return { id: newMessageId(), role: 'assistant', content: errorHtml(entry.text) };
      case 'summary':
        return { id: newMessageId(), role: 'assistant', content: summaryHtml(entry.text) };
    }
  });
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState('Thinking');
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileItem[]>([]);
  const [tokenUsage, setTokenUsage] = useState<{ used: number, total: number } | null>(null);
  const [modelInfo, setModelInfo] = useState<{ name: string; contextWindow: number } | null>(null);
  const [confirmations, setConfirmations] = useState<ConfirmationRequest[]>([]);

  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(undefined);

  const [mentionVisible, setMentionVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'workspaceFiles':
          setWorkspaceFiles(message.files);
          break;
        case 'filesAttached': {
          const incomingFiles: FileAttachment[] = message.files || [];
          Promise.all(
            incomingFiles.map(async (file) => {
              if (file.name.toLowerCase().endsWith('.pdf') && file.data) {
                try {
                  const extracted = await extractPdfText(file.data);
                  return { ...file, extractedText: extracted, data: undefined };
                } catch (err) {
                  console.error('Failed to parse PDF in frontend:', err);
                  return file;
                }
              }
              return file;
            })
          ).then((processedFiles) => {
            setAttachedFiles(prev => {
              const newFiles = [...prev];
              processedFiles.forEach((f: FileAttachment) => {
                const existingIdx = newFiles.findIndex(existing => existing.fsPath === f.fsPath);
                if (existingIdx >= 0) {
                  newFiles[existingIdx] = f;
                } else {
                  newFiles.push(f);
                }
              });
              return newFiles;
            });
          });
          break;
        }
        case 'loadingMessage':
          setIsGenerating(true);
          setIsThinking(true);
          setThinkingText(message.text || 'Thinking');
          break;
        case 'agentThinking':
          setIsGenerating(true);
          setIsThinking(true);
          setThinkingText(message.text || 'Thinking');
          break;
        case 'streamToken':
          setIsGenerating(true);
          setIsThinking(false);
          setStreamingContent(prev => prev + message.token);
          break;
        case 'streamReasoning':
          setIsGenerating(true);
          setIsThinking(false);
          setStreamingReasoning(prev => prev + message.token);
          break;
        case 'toolStart':
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            const newTc = { id: message.toolCallId, name: message.toolName, args: message.args, status: 'running' as const, open: false };
            if (lastMsg && lastMsg.role === 'assistant') {
              return prev.map((m, i) => i === prev.length - 1 
                ? { ...m, toolCalls: [...(m.toolCalls || []), newTc] }
                : m
              );
            }
            return [...prev, {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              role: 'assistant',
              content: '',
              toolCalls: [newTc]
            }];
          });
          break;
        case 'toolResult':
          setMessages(prev => prev.map(msg => {
            if (!msg.toolCalls) return msg;
            return {
              ...msg,
              toolCalls: msg.toolCalls.map(tc => 
                tc.id === message.toolCallId
                  ? { ...tc, result: message.result, status: 'done', open: false }
                  : tc
              )
            };
          }));
          break;
        case 'finalizeStream':
          setIsGenerating(message.done === false);
          setIsThinking(false);
          setThinkingText('Thinking');
          if (message.text || message.reasoning) {
            setMessages(prev => [
              ...prev,
              {
                id: newMessageId(),
                role: 'assistant',
                content: message.text ? renderMd(message.text) : '',
                reasoning: message.reasoning ? renderMd(message.reasoning) : undefined,
                reasoningTimeMs: message.reasoningTimeMs
              }
            ]);
          }
          setStreamingContent('');
          setStreamingReasoning('');
          break;
        case 'agentError':
          setIsGenerating(false);
          setIsThinking(false);
          setThinkingText('Thinking');
          setMessages(prev => [
            ...prev,
            { id: newMessageId(), role: 'assistant', content: errorHtml(message.text) }
          ]);
          break;
        case 'summaryCompleted':
          if (message.summary) {
            setMessages(prev => [
              ...prev,
              {
                id: newMessageId(),
                role: 'assistant',
                content: summaryHtml(message.summary)
              }
            ]);
          }
          break;
        case 'tokenUsage':
          setTokenUsage({
            used: message.usage.total_tokens,
            total: message.contextWindow
          });
          break;
        case 'insertText':
          setInput(prev => prev ? prev + '\n\n' + message.text : message.text);
          if (inputRef.current) {
            inputRef.current.focus();
          }
          break;
        case 'modelInfo':
          setModelInfo(message.info);
          setTokenUsage({ used: 0, total: message.info.contextWindow });
          break;
        case 'askConfirmation':
          setConfirmations(prev => [...prev, { id: message.id, text: message.text }]);
          break;
        case 'sessionList':
          setSessions(message.sessions || []);
          setCurrentSessionId(message.currentSessionId);
          break;
        case 'sessionRestored':
          isNearBottomRef.current = true;
          setMessages(entriesToMessages(message.entries || []));
          setCurrentSessionId(message.sessionId);
          setStreamingContent('');
          setStreamingReasoning('');
          setIsGenerating(false);
          setIsThinking(false);
          setThinkingText('Thinking');
          setConfirmations([]);
          setAttachedFiles([]);
          setTokenUsage(prev => ({
            used: message.usage?.total_tokens ?? 0,
            total: message.contextWindow || prev?.total || 0,
          }));
          setView('chat');
          break;
        case 'sessionCleared':
          setMessages([]);
          setCurrentSessionId(undefined);
          setStreamingContent('');
          setStreamingReasoning('');
          setIsGenerating(false);
          setIsThinking(false);
          setThinkingText('Thinking');
          setConfirmations([]);
          setTokenUsage(prev => prev ? { used: 0, total: prev.total } : null);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'getWorkspaceFiles' });
    vscode.postMessage({ command: 'webviewReady' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);
  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollHeight, scrollTop, clientHeight } = chatContainerRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 20;
    }
  };

  useEffect(() => {
    const currentMessages = messages;
    const previousMessages = prevMessagesRef.current;
    
    const isToolCallToggle = currentMessages.some(msg => 
      msg.toolCalls && msg.toolCalls.some(tc => {
        const prevMsg = previousMessages.find(p => p.id === msg.id);
        const prevTc = prevMsg?.toolCalls?.find(pTc => pTc.id === tc.id);
        return prevTc && prevTc.open !== tc.open;
      })
    );

    if (!isToolCallToggle && isNearBottomRef.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }

    prevMessagesRef.current = currentMessages;
  }, [messages, streamingContent, streamingReasoning, isThinking, isGenerating]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight + 2, 120) + 'px';
    }
  }, [input]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    
    setAttachedFiles(prev => prev.filter(f => val.includes(`@${f.name}`)));

    // Check mention
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(^|\s)@([^\s]*)$/);

    if (match) {
      setMentionStartIndex(textBeforeCursor.length - match[2].length - 1);
      setMentionQuery(match[2]);
      if (!mentionVisible && workspaceFiles.length === 0) {
        vscode.postMessage({ command: 'getWorkspaceFiles' });
      }
      setMentionVisible(true);
    } else {
      setMentionVisible(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() && attachedFiles.length === 0) return;
    
    setMentionVisible(false);
    const userText = input.trim() || 'Please review the attached file(s).';
    
    setMessages(prev => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'user', content: userText }
    ]);
    
    vscode.postMessage({
      command: 'sendChat',
      text: userText,
      attachments: attachedFiles
    });
    
    setInput('');
    setAttachedFiles([]);
    setIsGenerating(true);
    setIsThinking(true);
    setThinkingText('Thinking');
  };

  const selectMentionFile = (file: WorkspaceFileItem) => {
    const mentionText = '@' + file.name + ' ';
    const startIdx = mentionStartIndex >= 0 ? mentionStartIndex : input.lastIndexOf('@');
    const queryLen = mentionQuery ? mentionQuery.length : 0;
    const endIdx = startIdx >= 0 ? startIdx + 1 + queryLen : (inputRef.current?.selectionStart || 0);

    const beforeAt = startIdx >= 0 ? input.slice(0, startIdx) : '';
    const afterMention = endIdx <= input.length ? input.slice(endIdx) : '';

    setInput(beforeAt + mentionText + afterMention);
    setMentionVisible(false);
    
    if (inputRef.current) {
      inputRef.current.focus();
    }
    
    vscode.postMessage({
      command: 'attachMentionedFile',
      fsPath: file.fsPath
    });
  };

  const handleNewChat = () => {
    vscode.postMessage({ command: 'newChat' });
    setMessages([]);
    setStreamingContent('');
    setStreamingReasoning('');
    setIsGenerating(false);
    setIsThinking(false);
    setThinkingText('Thinking');
    setAttachedFiles([]);
    setConfirmations([]);
    setInput('');
    setCurrentSessionId(undefined);
    setView('chat');
    setTokenUsage(prev => prev ? { used: 0, total: prev.total } : null);
  };

  const toggleHistory = () => {
    if (view === 'history') {
      setView('chat');
      return;
    }
    setSessions(null);
    setView('history');
    vscode.postMessage({ command: 'listSessions' });
  };

  const filteredMentionFiles = mentionVisible ? workspaceFiles.filter(f => 
    !attachedFiles.some(a => a.fsPath === f.fsPath) &&
    (f.name.toLowerCase().includes(mentionQuery.toLowerCase()) || f.relativePath.toLowerCase().includes(mentionQuery.toLowerCase()))
  ).slice(0, 25) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="header">
        <button className="new-chat-btn" onClick={handleNewChat} title="Start a new chat">
          + New Chat
        </button>
        <button
          className={`new-chat-btn history-btn ${view === 'history' ? 'active' : ''}`}
          onClick={toggleHistory}
          disabled={isGenerating}
          title={isGenerating ? 'Unavailable while generating' : 'Browse saved conversations'}
        >
          History
        </button>
      </div>

      {view === 'history' && (
        <div className="history-view">
          <div className="history-header">
            <button className="history-back" onClick={() => setView('chat')} title="Back to chat">← Back</button>
            <span className="history-title">Saved conversations</span>
          </div>
          {sessions === null ? (
            <div className="history-empty">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="history-empty">No saved conversations yet.</div>
          ) : (
            <div className="history-list">
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`history-item ${s.id === currentSessionId ? 'active' : ''}`}
                  onClick={() => vscode.postMessage({ command: 'loadSession', id: s.id })}
                  title="Open this conversation"
                >
                  <div className="history-main">
                    <div className="history-item-title">{s.title}</div>
                    <div className="history-meta">
                      {formatRelativeTime(s.updatedAt)} · {s.messageCount} turn{s.messageCount === 1 ? '' : 's'}
                      {s.id === currentSessionId && <span className="history-current"> · current</span>}
                    </div>
                  </div>
                  <div className="history-actions">
                    <button
                      className="history-action"
                      title="Export as Markdown"
                      onClick={(e) => {
                        e.stopPropagation();
                        vscode.postMessage({ command: 'exportSession', id: s.id });
                      }}
                    >⤓</button>
                    <button
                      className="history-action delete"
                      title="Delete conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        vscode.postMessage({ command: 'deleteSession', id: s.id });
                      }}
                    >🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        id="chat-container"
        ref={chatContainerRef}
        onScroll={handleScroll}
        style={view === 'history' ? { display: 'none' } : undefined}
      >
        {messages.map(msg => (
          <div key={msg.id} className={msg.role === 'user' ? 'msg-user' : 'msg-assistant'}>
            {msg.reasoning && (
              <details className="msg-reasoning">
                <summary>Thought for {msg.reasoningTimeMs ? `${(msg.reasoningTimeMs / 1000).toFixed(1)}s` : ''}</summary>
                <div className="reasoning-body" dangerouslySetInnerHTML={{ __html: msg.reasoning }} />
              </details>
            )}
            
            {msg.content && (
              msg.role === 'user' 
                ? msg.content
                : <div className="msg-content" dangerouslySetInnerHTML={{ __html: msg.content }} />
            )}
            
            {msg.toolCalls && msg.toolCalls.map(tc => (
              <div key={tc.id} className={`tool-block ${tc.open ? 'open' : ''}`}>
                <div className="tool-header" onClick={() => {
                  setMessages(prev => prev.map(m => 
                    m.id === msg.id 
                      ? { ...m, toolCalls: m.toolCalls?.map(t => t.id === tc.id ? { ...t, open: !t.open } : t) }
                      : m
                  ));
                }}>
                  <span className="tool-icon">🔧</span>
                  <span className="tool-name">{tc.name}</span>
                  <span className={`tool-status ${tc.status}`}>{tc.status === 'running' ? 'Running...' : 'Done'}</span>
                </div>
                <div className="tool-body">
                  <div className="tool-args">{tc.args}</div>
                  {tc.result && <div className="tool-result">{tc.result}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
        
        {(streamingContent || streamingReasoning) && (
          <div className="msg-assistant">
            {streamingReasoning && (
               <details className="msg-reasoning" open>
                 <summary>Thinking</summary>
                 <div className="reasoning-body" dangerouslySetInnerHTML={{ __html: safeSanitize(marked.parse(streamingReasoning) as string) }} />
               </details>
            )}
            
            {streamingContent && (
              <div className="msg-content" dangerouslySetInnerHTML={{ __html: safeSanitize(marked.parse(streamingContent) as string) }} />
            )}

            {isThinking && (
              <div className="thinking-indicator" style={{ marginTop: '8px' }}>
                {thinkingText}
                <div className="thinking-dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
          </div>
        )}
        
        {isThinking && !streamingContent && !streamingReasoning && (
          <div className="thinking-indicator">
            {thinkingText}
            <div className="thinking-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>
      
      <div id="input-area">
        {mentionVisible && filteredMentionFiles.length > 0 && (
          <div id="mention-dropdown" style={{ display: 'flex' }}>
            {filteredMentionFiles.map((file, idx) => (
              <div 
                key={file.fsPath} 
                className={`mention-item ${idx === mentionSelectedIndex ? 'active' : ''}`}
                onClick={() => selectMentionFile(file)}
              >
                <span className="mention-icon">📄</span>
                <span className="mention-name">{file.name}</span>
                <span className="mention-path">{file.relativePath}</span>
              </div>
            ))}
          </div>
        )}
        
        {attachedFiles.length > 0 && (
          <div id="attachments-tray" style={{ display: 'flex' }}>
            {attachedFiles.map(file => (
              <div key={file.id} className="attachment-chip">
                <span>{file.name.toLowerCase().endsWith('.pdf') ? '📕' : file.isBinary ? '📦' : '📄'}</span>
                <span className="chip-name">{file.name}</span>
                <span className="chip-size">{formatBytes(file.size)}</span>
              </div>
            ))}
          </div>
        )}

        {confirmations.map(conf => (
          <div key={conf.id} className="confirmation-dialog">
            <div className="confirmation-text">{conf.text}</div>
            <div className="confirmation-actions">
              <button className="confirm-btn allow" onClick={() => {
                vscode.postMessage({ command: 'answerConfirmation', id: conf.id, result: true });
                setConfirmations(prev => prev.filter(c => c.id !== conf.id));
              }}>Allow</button>
              <button className="confirm-btn deny" onClick={() => {
                vscode.postMessage({ command: 'answerConfirmation', id: conf.id, result: false });
                setConfirmations(prev => prev.filter(c => c.id !== conf.id));
              }}>Deny</button>
            </div>
          </div>
        ))}
        
        <div id="input-row">
          <textarea
            ref={inputRef}
            id="message-input"
            placeholder="Ask anything... (@ to attach file)"
            rows={1}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (mentionVisible) {
                  e.preventDefault();
                  if (filteredMentionFiles[mentionSelectedIndex]) {
                    selectMentionFile(filteredMentionFiles[mentionSelectedIndex]);
                  }
                } else {
                  e.preventDefault();
                  handleSend();
                }
              } else if (mentionVisible) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionSelectedIndex(prev => (prev + 1) % filteredMentionFiles.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionSelectedIndex(prev => (prev - 1 + filteredMentionFiles.length) % filteredMentionFiles.length);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setMentionVisible(false);
                }
              }
            }}
          />
          {isGenerating ? (
            <button id="stop-button" onClick={() => vscode.postMessage({ command: 'stopGeneration' })}>Stop</button>
          ) : (
            <button id="send-button" onClick={handleSend} disabled={!input.trim() && attachedFiles.length === 0}>Send</button>
          )}
        </div>

        {(modelInfo || tokenUsage) && (
          <div className="footer-info">
            {modelInfo && (
              <span className="model-label">
                {modelInfo.name.split(/[/\\]/).pop()?.split('.')[0]}
              </span>
            )}
            {modelInfo && tokenUsage && <span className="separator">·</span>}
            {tokenUsage && (
              <span className="usage-label">
                {formatK(tokenUsage.used)} / {formatK(tokenUsage.total)} tokens
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;