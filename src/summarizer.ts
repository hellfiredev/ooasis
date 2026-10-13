import { API_HOST } from './config';
import { ChatCompletionResponse, Message, ToolResultMessage } from './types/chat';

/** Threshold ratio of prompt_tokens / contextWindow to trigger summarization */
const TOKEN_USAGE_THRESHOLD_RATIO = 0.5;


export interface SummarizerResult {
  summary: string;
  trimmedHistory: (Message | ToolResultMessage)[];
}

export class ConversationSummarizer {
  private _isSummarizing = false;
  private _conversationSummary = '';

  get summary(): string {
    return this._conversationSummary;
  }

  get isSummarizing(): boolean {
    return this._isSummarizing;
  }

  reset(): void {
    this._conversationSummary = '';
    this._isSummarizing = false;
  }

  /**
   * Determine whether summarization should run.
   */
  shouldSummarize(
    promptTokens: number,
    contextWindow: number,
  ): boolean {
    if (contextWindow <= 0) { return false; }
    if (this._isSummarizing) { return false; }
    return promptTokens > contextWindow * TOKEN_USAGE_THRESHOLD_RATIO;
  }

  /**
   * Build API messages with the summary appended to the system prompt.
   */
  buildMessagesWithSummary(
    chatHistory: (Message | ToolResultMessage)[]
  ): (Message | ToolResultMessage)[] {
    if (!this._conversationSummary) { return [...chatHistory]; }

    const messages = [...chatHistory];
    const systemPrompt = messages[0].content as string;
    messages[0] = {
      ...messages[0],
      content: `${systemPrompt}\n\n[PREVIOUS CONVERSATION SUMMARY]:\n${this._conversationSummary}`,
    };
    return messages;
  }

  /**
   * Run summarization. Throws on failure — caller handles notification.
   */
  async summarize(
    chatHistory: (Message | ToolResultMessage)[],
    modelName: string,
    signal?: AbortSignal,
    summarizeAll = false
  ): Promise<SummarizerResult> {
    this._isSummarizing = true;

    try {
      const systemPrompt = chatHistory[0];
      const isFullSummarization = summarizeAll || !this._conversationSummary;

      // In incremental mode, keep the latest user message out of the summary
      const messagesToSummarize = isFullSummarization
        ? chatHistory.slice(1)
        : chatHistory.slice(1, -1);

      if (messagesToSummarize.length === 0) {
        return {
          summary: this._conversationSummary,
          trimmedHistory: chatHistory,
        };
      }

      console.log("messagesToSummarize:", messagesToSummarize);
      const summarizeCount = messagesToSummarize.length;
      const transcript = this.buildTranscript(messagesToSummarize);
      console.log("transcript", transcript);
      const summaryPrompt = this.buildSummaryPrompt(transcript);
      console.log("summaryPrompt", summaryPrompt);

      const response = await fetch(`${API_HOST}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: modelName,
          stream: false,
          messages: [
            { role: 'system', content: 'You are a concise technical summarizer. Produce short, dense summaries.' },
            { role: 'user', content: summaryPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Summarization API error: HTTP ${response.status}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const summaryText = data.choices[0].message.content?.trim() ?? '';

      this._conversationSummary = summaryText;

      // Rebuild history: system prompt + messages that were not summarized
      const retainedMessages = chatHistory.slice(summarizeCount + 1);
      const trimmedHistory: (Message | ToolResultMessage)[] = [
        systemPrompt,
        ...retainedMessages,
      ];

      return { summary: summaryText, trimmedHistory };
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
      if (msg.role === 'tool') { continue; }

      const chatMsg = msg as Message;
      if (!chatMsg.content) { continue; }

      parts.push(`${chatMsg.role.toUpperCase()}: ${chatMsg.content}`);
    }

    return parts.join('\n');
  }

  /**
   * Build the prompt for the summarizer LLM, requesting a concise output.
   */
  private buildSummaryPrompt(transcript: string): string {
    const instructions = `Summarize the conversation below into a concise bullet-point list.
Focus only on: key decisions, outcomes, file paths modified, and errors encountered.
Omit pleasantries, reasoning details, and raw code/data. Keep it short — every token saved here is a token available for the ongoing conversation.`;

    if (this._conversationSummary) {
      return `${instructions}

Merge the previous summary with the new messages into one updated summary.

[PREVIOUS SUMMARY]:
${this._conversationSummary}

[NEW MESSAGES]:
${transcript}`;
    }

    return `${instructions}

[MESSAGES]:
${transcript}`;
  }
}
