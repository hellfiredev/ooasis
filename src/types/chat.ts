export interface ChatCompletionResponse {
  choices: Choice[];
  created: number;
  id: string;
  model: string;
  object: string;
  system_fingerprint: string;
  timings: Timings;
  usage: Usage;
}

export interface Choice {
  finish_reason: string;
  index: number;
  message: Message;
}

export interface Message {
  content: string;
  reasoning_content?: string; // Optional since some models might not return this
  role: string;
}

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
  prompt_tokens_details: PromptTokensDetails;
  total_tokens: number;
}

export interface PromptTokensDetails {
  cached_tokens: number;
}
