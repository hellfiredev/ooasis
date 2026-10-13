import { API_HOST } from './config';
import { ChatCompletionResponse, Message, ToolResultMessage } from './types/chat';

/** Threshold ratio of prompt_tokens / contextWindow to trigger summarization */
const TOKEN_USAGE_THRESHOLD_RATIO = 0.8;


export interface SummarizerResult {
  summary: string;
  trimmedHistory: (Message | ToolResultMessage)[];
  totalTokens: number;
}

export class ConversationSummarizer {
  private _isSummarizing = false;

  get isSummarizing(): boolean {
    return this._isSummarizing;
  }

  reset(): void {
    this._isSummarizing = false;
  }

  /**
   * Determine whether summarization should run.
   */
  shouldSummarize(
    usedTokens: number,
    contextWindow: number,
  ): boolean {
    if (contextWindow <= 0) { return false; }
    if (this._isSummarizing) { return false; }
    return usedTokens > contextWindow * TOKEN_USAGE_THRESHOLD_RATIO;
  }

  /**
   * Run summarization. Throws on failure — caller handles notification.
   */
  async summarize(
    chatHistory: (Message | ToolResultMessage)[],
    modelName: string,
    signal?: AbortSignal
  ): Promise<SummarizerResult> {
    console.debug(`start summarize()`);
    this._isSummarizing = true;

    try {
      const systemPrompt = chatHistory[0];
      // Keep the latest user message out of the summary
      const messagesToSummarize = chatHistory.slice(1, -1);

      if (messagesToSummarize.length === 0) {
        console.debug("messagesToSummarize is empty");
        return {
          summary: '',
          trimmedHistory: chatHistory,
          totalTokens: 0
        };
      }

      const summarizeCount = messagesToSummarize.length;
      const transcript = this.buildTranscript(messagesToSummarize);
      console.log("transcript to summarize:", transcript);
      const summaryPrompt = this.buildSummaryPrompt(transcript);

      const response = await fetch(`${API_HOST}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: modelName,
          stream: false,
          messages: [
            { role: 'user', content: summaryPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Summarization API error: HTTP ${response.status}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const summaryText = data.choices[0].message.content?.trim() ?? '';

      // Rebuild history: system prompt + messages that were not summarized
      const retainedMessages = chatHistory.slice(summarizeCount + 1);
      const trimmedHistory: (Message | ToolResultMessage)[] = [
        systemPrompt,
        {
          content: "Tell me about our conversation",
          role: "user",
        },
        {
          content: summaryText,
          role: "assistant",
        },
        ...retainedMessages,
      ];

      return { summary: summaryText, trimmedHistory, totalTokens: data.usage.total_tokens };
    } finally {
      this._isSummarizing = false;
    }
  }

  /**
   * Build a compact transcript from user and assistant messages only.
   * Tool calls, tool results, and file content are excluded.
   */
  private buildTranscript(messages: (Message | ToolResultMessage)[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      const chatMsg = msg as Message;
      parts.push(`${chatMsg.role.toUpperCase()}: ${chatMsg.content}`);
    }

    return parts.join('\n');
  }

  /**
   * Build the prompt for the summarizer LLM, requesting a concise output.
   */
  private buildSummaryPrompt(transcript: string): string {
    const instructions = `Summarize the conversation below into a concise bullet-point list. 
    Each bullet-point correspond to a message. 
    No need to go into details.
    Here is the transcript:
    ${transcript}`;

    return instructions;
  }
}
