import * as assert from 'assert';
import { sessionToMarkdown } from '../history/markdownExport';
import { SessionFile } from '../types/chat';

suite('MarkdownExport Test Suite', () => {
  test('should generate correct markdown from display log', () => {
    const session: SessionFile = {
      id: 'test-session',
      title: 'Test Session',
      createdAt: new Date('2024-01-01T10:00:00Z').getTime(),
      updatedAt: new Date('2024-01-01T10:05:00Z').getTime(),
      messageCount: 1,
      version: 1,
      totalUsedTokens: 0,
      apiHistory: [],
      displayLog: [
        {
          type: 'user',
          text: 'Hello, world!',
          timestamp: 1
        },
        {
          type: 'assistant',
          text: 'Hi there!',
          reasoning: 'I should say hello back.',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tool_1',
              name: 'calculator',
              args: '{"expr": "1+1"}',
              result: '2'
            }
          ]
        }
      ]
    };

    const markdown = sessionToMarkdown(session);

    assert.ok(markdown.includes('# Test Session'), 'Should contain title');
    assert.ok(markdown.includes('### 🧑 User'), 'Should contain User heading');
    assert.ok(markdown.includes('Hello, world!'), 'Should contain user message');
    assert.ok(markdown.includes('### 🤖 Assistant'), 'Should contain Assistant heading');
    assert.ok(markdown.includes('Hi there!'), 'Should contain assistant message');
    assert.ok(markdown.includes('<details><summary>Reasoning</summary>'), 'Should contain reasoning dropdown');
    assert.ok(markdown.includes('I should say hello back.'), 'Should contain reasoning text');
    assert.ok(markdown.includes('<summary>🔧 calculator</summary>'), 'Should contain tool call heading');
    assert.ok(markdown.includes('"expr": "1+1"'), 'Should contain tool args');
    assert.ok(markdown.includes('2'), 'Should contain tool result');
  });

  test('should handle empty session gracefully', () => {
    const session: SessionFile = {
      id: 'empty-session',
      title: 'Empty',
      createdAt: 0,
      updatedAt: 0,
      messageCount: 0,
      version: 1,
      totalUsedTokens: 0,
      apiHistory: [],
      displayLog: []
    };

    const markdown = sessionToMarkdown(session);
    assert.ok(markdown.includes('# Empty'));
    assert.ok(!markdown.includes('### 🧑 User'));
    assert.ok(!markdown.includes('### 🤖 Assistant'));
  });
});
