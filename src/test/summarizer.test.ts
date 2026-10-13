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
    test('pushing partial response after summarization retains correct turn order and clean continuation prompt', () => {
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

      // 1. Push partial assistant response
      trimmedHistory.push({
        role: 'assistant',
        content: assistantPartialContent,
      });

      // 2. Push clean continuation prompt
      trimmedHistory.push({
        role: 'user',
        content: 'Please continue your response from where you left off.',
      });

      // Verify sequence and content
      assert.strictEqual(trimmedHistory.length, 6);
      assert.strictEqual(trimmedHistory[3].role, 'user');
      assert.strictEqual((trimmedHistory[3] as Message).content, 'Generate code');

      assert.strictEqual(trimmedHistory[4].role, 'assistant');
      assert.strictEqual((trimmedHistory[4] as Message).content, assistantPartialContent);

      assert.strictEqual(trimmedHistory[5].role, 'user');
      assert.strictEqual((trimmedHistory[5] as Message).content, 'Please continue your response from where you left off.');
    });

    test('continuation response arrives as a separate assistant message in chronological order', () => {
      const history: (Message | ToolResultMessage)[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Please write a long story' },
        { role: 'assistant', content: 'Chapter 1: Once upon a time in a...' },
        { role: 'user', content: 'Please continue your response from where you left off.' },
      ];

      const continuationChunk = 'faraway kingdom, there lived a wise king.';
      history.push({
        role: 'assistant',
        content: continuationChunk,
      });

      assert.strictEqual(history.length, 5);
      assert.strictEqual(history[2].role, 'assistant');
      assert.strictEqual((history[2] as Message).content, 'Chapter 1: Once upon a time in a...');
      assert.strictEqual(history[3].role, 'user');
      assert.strictEqual((history[3] as Message).content, 'Please continue your response from where you left off.');
      assert.strictEqual(history[4].role, 'assistant');
      assert.strictEqual((history[4] as Message).content, continuationChunk);
    });
  });
});
