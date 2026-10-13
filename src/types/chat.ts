// ─── Chat Completion Types ────────────────────────────────────────────────────

export interface ChatCompletionResponse {
  choices: Choice[];
  created: number;
  id: string;
  model: string;
  object: string;
  system_fingerprint: string;
  timings?: Timings;
  usage: Usage;
}

export interface Choice {
  finish_reason: string | null;
  index: number;
  message: Message;
}

export interface Message {
  content: string | null;
  reasoning_content?: string;
  role: string;
  tool_calls?: ToolCall[];
}

// ─── Tool Call Types ──────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

// ─── Tool Input Argument Types ────────────────────────────────────────────────

export interface ReadFileArgs {
  path: string;
  start_line?: number;
  end_line?: number;
}

export interface WriteFileArgs {
  path: string;
  content: string;
}

export interface ReplaceInFileArgs {
  path: string;
  start_line: number;
  end_line: number;
  content: string;
}

export interface RunTerminalArgs {
  command: string;
  cwd?: string;
}

export interface SearchWorkspaceArgs {
  query: string;
  include_pattern?: string;
  is_regex?: boolean;
}

export interface ListDirectoryArgs {
  path: string;
}

// ─── Streaming Chunk Types ────────────────────────────────────────────────────

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChunkChoice[];
  usage?: Usage;
}

export interface ChunkChoice {
  index: number;
  delta: ChunkDelta;
  finish_reason: string | null;
}

export interface ChunkDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCallChunk[];
}

export interface ToolCallChunk {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

// ─── Timing & Usage ──────────────────────────────────────────────────────────

export interface Timings {
  cache_n: number;
  predicted_ms: number;
  predicted_n: number;
  predicted_per_second: number;
  predicted_per_token_ms: number;
  prompt_ms: number;
  prompt_n: number;
  prompt_per_second: number;
  prompt_per_token_ms: number;
}

export interface Usage {
  completion_tokens: number;
  prompt_tokens: number;
  prompt_tokens_details?: PromptTokensDetails;
  total_tokens: number;
}

export interface PromptTokensDetails {
  cached_tokens: number;
}

// ─── File Attachment Types ───────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  name: string;
  fsPath: string;
  relativePath: string;
  size: number;
  isBinary: boolean;
}

export interface WorkspaceFileItem {
  name: string;
  relativePath: string;
  fsPath: string;
}
