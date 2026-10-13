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
              name: 'run_terminal',
              args: '{"command": "echo hi"}',
              result: 'TERMINAL_OUTPUT_MARKER'
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
    assert.ok(markdown.includes('<summary>run_terminal</summary>'), 'Should contain tool call heading');
    assert.ok(markdown.includes('"command": "echo hi"'), 'Should contain tool args');
    assert.ok(markdown.includes('TERMINAL_OUTPUT_MARKER'), 'Should contain run_terminal result');
  });

  test('should omit result for tools with hidden output', () => {
    const session: SessionFile = {
      id: 'hidden-output',
      title: 'Hidden',
      createdAt: 0,
      updatedAt: 0,
      messageCount: 1,
      version: 1,
      totalUsedTokens: 0,
      apiHistory: [],
      displayLog: [
        {
          type: 'assistant',
          text: '',
          timestamp: 1,
          toolCalls: [
            { id: 't1', name: 'read_file', args: '{"path": "a.ts"}', result: 'FILE_CONTENT_MARKER' },
          ],
        },
      ],
    };

    const markdown = sessionToMarkdown(session);
    assert.ok(markdown.includes('<summary>read_file</summary>'), 'Should contain tool call heading');
    assert.ok(markdown.includes('"path": "a.ts"'), 'Should contain tool args');
    assert.ok(!markdown.includes('FILE_CONTENT_MARKER'), 'Should not contain read_file result');
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
