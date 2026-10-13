import {
  DisplayAssistantEntry,
  DisplayEntry,
} from '../types/chat';

/**
 * Builds a human-readable, raw-markdown transcript of a conversation by
 * observing the same messages the extension posts to the webview.
 *
 * The reducer logic intentionally mirrors the webview's message handler in
 * `webview-ui/src/App.tsx` so that a restored session renders identically
 * to how it looked live.
 */
export class DisplayLogBuilder {
  private _entries: DisplayEntry[];

  constructor(initial: DisplayEntry[] = []) {
    // Deep-ish copy so mutations (tool results) never touch the caller's array
    this._entries = initial.map((e) =>
      e.type === 'assistant' && e.toolCalls
        ? { ...e, toolCalls: e.toolCalls.map((tc) => ({ ...tc })) }
        : { ...e }
    );
  }

  get entries(): DisplayEntry[] {
    return this._entries;
  }

  get userTurnCount(): number {
    return this._entries.filter((e) => e.type === 'user').length;
  }

  addUser(text: string, attachments?: string[]): void {
    this._entries.push({
      type: 'user',
      text,
      ...(attachments && attachments.length > 0 && { attachments }),
      timestamp: Date.now(),
    });
  }

  /**
   * Feed any message posted to the webview. Commands that don't affect the
   * transcript (streamToken, tokenUsage, ...) are ignored.
   */
  apply(msg: Record<string, unknown>): void {
    switch (msg.command) {
      case 'finalizeStream': {
        const text = typeof msg.text === 'string' ? msg.text : '';
        const reasoning = typeof msg.reasoning === 'string' ? msg.reasoning : '';
        if (!text && !reasoning) { return; }
        const entry: DisplayAssistantEntry = {
          type: 'assistant',
          text,
          timestamp: Date.now(),
        };
        if (reasoning) { entry.reasoning = reasoning; }
        if (typeof msg.reasoningTimeMs === 'number') { entry.reasoningTimeMs = msg.reasoningTimeMs; }
        this._entries.push(entry);
        return;
      }

      case 'toolStart': {
        const toolCall = {
          id: String(msg.toolCallId ?? ''),
          name: String(msg.toolName ?? ''),
          args: String(msg.args ?? ''),
        };
        const last = this._entries[this._entries.length - 1];
        if (last && last.type === 'assistant') {
          last.toolCalls = [...(last.toolCalls ?? []), toolCall];
        } else {
          this._entries.push({
            type: 'assistant',
            text: '',
            toolCalls: [toolCall],
            timestamp: Date.now(),
          });
        }
        return;
      }

      case 'toolResult': {
        const id = String(msg.toolCallId ?? '');
        const result = String(msg.result ?? '');
        for (const entry of this._entries) {
          if (entry.type !== 'assistant' || !entry.toolCalls) { continue; }
          for (const tc of entry.toolCalls) {
            if (tc.id === id) { tc.result = result; }
          }
        }
        return;
      }

      case 'agentError': {
        this._entries.push({
          type: 'error',
          text: String(msg.text ?? ''),
          timestamp: Date.now(),
        });
        return;
      }

      case 'summaryCompleted': {
        if (typeof msg.summary === 'string' && msg.summary) {
          this._entries.push({
            type: 'summary',
            text: msg.summary,
            timestamp: Date.now(),
          });
        }
        return;
      }
    }
  }
}
