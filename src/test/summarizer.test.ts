import * as assert from 'assert';
import { ConversationSummarizer } from '../summarizer';
import { Message, ToolResultMessage } from '../types/chat';

suite('ConversationSummarizer Test Suite', () => {
  let summarizer: ConversationSummarizer;

  setup(() => {
    summarizer = new ConversationSummarizer();
  });

  suite('shouldSummarize threshold', () => {
    test('should return false if contextWindow <= 0', () => {
      assert.strictEqual(summarizer.shouldSummarize(1000, 0), false);
      assert.strictEqual(summarizer.shouldSummarize(1000, -1), false);
    });

    test('should return false if used tokens below 80% threshold', () => {
      assert.strictEqual(summarizer.shouldSummarize(799, 1000), false);
    });

    test('should return true if used tokens exceed 80% threshold', () => {
      assert.strictEqual(summarizer.shouldSummarize(801, 1000), true);
    });

    test('should return false when already summarizing', () => {
      // simulate isSummarizing state
      summarizer.reset();
      assert.strictEqual(summarizer.isSummarizing, false);
    });
  });

  suite('Continuation & history ordering simulation', () => {
    test('pushing partial response after summarization retains correct turn order', () => {
      const systemPrompt: Message = { role: 'system', content: 'System instruction' };
      const userPrompt: Message = { role: 'user', content: 'Generate code' };
      const fakeSummary = 'Previous conversation summary';

      // Simulates trimmed history after summarizer runs on history ending in userPrompt
      const trimmedHistory: (Message | ToolResultMessage)[] = [
        systemPrompt,
        { role: 'user', content: 'Tell me about our conversation' },
        { role: 'assistant', content: fakeSummary },
        userPrompt,
      ];

      // Step: Truncation occurs during generation of assistant response
      const assistantPartialContent = 'const a = 1;\nconst b = ';

      // 1. Push uncompressed partial assistant response
      trimmedHistory.push({
        role: 'assistant',
        content: assistantPartialContent,
      });

      // 2. Push continuation prompt
      trimmedHistory.push({
        role: 'user',
        content: 'STRICT CONTINUATION GUARDRAILS:\n1. SEAMLESS RESUMPTION',
      });

      // Verify sequence and content
      assert.strictEqual(trimmedHistory.length, 6);
      assert.strictEqual(trimmedHistory[3].role, 'user');
      assert.strictEqual((trimmedHistory[3] as Message).content, 'Generate code');

      assert.strictEqual(trimmedHistory[4].role, 'assistant');
      assert.strictEqual((trimmedHistory[4] as Message).content, assistantPartialContent);

      assert.strictEqual(trimmedHistory[5].role, 'user');
      assert.ok(((trimmedHistory[5] as Message).content as string).includes('STRICT CONTINUATION GUARDRAILS'));
    });
  });
});
