import { useState, useEffect, useRef } from 'react';
import { vscode } from './vscodeApi';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './index.css';

interface FileAttachment {
  id: string;
  name: string;
  fsPath: string;
  relativePath: string;
  size: number;
  isBinary: boolean;
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

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileItem[]>([]);

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
        case 'filesAttached':
          setAttachedFiles(prev => {
            const newFiles = [...prev];
            message.files.forEach((f: FileAttachment) => {
              if (!newFiles.some(existing => existing.fsPath === f.fsPath)) {
                newFiles.push(f);
              }
            });
            return newFiles;
          });
          break;
        case 'loadingMessage':
        case 'agentThinking':
          setIsThinking(true);
          break;
        case 'streamToken':
          setStreamingContent(prev => prev + message.token);
          break;
        case 'streamReasoning':
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
              id: Date.now().toString(),
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
          setIsThinking(false);
          if (message.text || message.reasoning) {
            setMessages(prev => [
              ...prev,
              {
                id: Date.now().toString(),
                role: 'assistant',
                content: message.text ? DOMPurify.sanitize(marked.parse(message.text) as string) : '',
                reasoning: message.reasoning ? DOMPurify.sanitize(marked.parse(message.reasoning) as string) : undefined,
                reasoningTimeMs: message.reasoningTimeMs
              }
            ]);
          }
          setStreamingContent('');
          setStreamingReasoning('');
          break;
        case 'agentError':
          setIsThinking(false);
          setMessages(prev => [
            ...prev,
            { id: Date.now().toString(), role: 'assistant', content: `<div class="error">${message.text}</div>` }
          ]);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'getWorkspaceFiles' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);
  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollHeight, scrollTop, clientHeight } = chatContainerRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 10;
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
  }, [messages, streamingContent, streamingReasoning, isThinking]);


  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    
    setAttachedFiles(prev => prev.filter(f => val.includes(`@${f.name}`)));
    
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';

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
      { id: Date.now().toString(), role: 'user', content: userText }
    ]);
    
    vscode.postMessage({
      command: 'sendChat',
      text: userText,
      attachments: attachedFiles
    });
    
    setInput('');
    setAttachedFiles([]);
    setIsThinking(true);
    
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
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
    setIsThinking(false);
    setAttachedFiles([]);
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const filteredMentionFiles = mentionVisible ? workspaceFiles.filter(f => 
    !attachedFiles.some(a => a.fsPath === f.fsPath) &&
    (f.name.toLowerCase().includes(mentionQuery.toLowerCase()) || f.relativePath.toLowerCase().includes(mentionQuery.toLowerCase()))
  ).slice(0, 25) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div className="header">
        <button className="new-chat-btn" onClick={handleNewChat} title="Start a new chat">
          + New Chat
        </button>
      </div>
      <div id="chat-container" ref={chatContainerRef} onScroll={handleScroll}>
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
                 <div className="reasoning-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(streamingReasoning) as string) }} />
               </details>
            )}
            
            {streamingContent && (
              <div className="msg-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(streamingContent) as string) }} />
            )}
          </div>
        )}
        
        {isThinking && !streamingContent && !streamingReasoning && (
          <div className="thinking-indicator">
            Thinking
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
                <span>{file.isBinary ? '📦' : '📄'}</span>
                <span className="chip-name">{file.name}</span>
                <span className="chip-size">{formatBytes(file.size)}</span>
              </div>
            ))}
          </div>
        )}
        
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
          <button id="send-button" onClick={handleSend} disabled={isThinking}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default App;