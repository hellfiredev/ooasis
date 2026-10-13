import * as assert from 'assert';
import { DisplayLogBuilder } from '../history/displayLog';
import { DisplayEntry } from '../types/chat';

suite('DisplayLogBuilder Test Suite', () => {
  let builder: DisplayLogBuilder;

  setup(() => {
    builder = new DisplayLogBuilder();
  });

  test('should handle addUser', () => {
    builder.addUser('Hello');
    const log = builder.entries;
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].type, 'user');
    assert.strictEqual(log[0].text, 'Hello');
    assert.strictEqual(builder.userTurnCount, 1);
  });

  test('should handle finalizeStream (assistant text only)', () => {
    builder.apply({ command: 'finalizeStream', text: 'Hi there!' });
    
    const log = builder.entries;
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].type, 'assistant');
    assert.strictEqual(log[0].text, 'Hi there!');
     
    assert.strictEqual((log[0] as any).reasoning, undefined);
  });

  test('should load existing log', () => {
    const existingLog: DisplayEntry[] = [
      { type: 'user', text: 'Existing user message', timestamp: 1 },
      { type: 'assistant', text: 'Existing assistant response', timestamp: 2 }
    ];
    const b = new DisplayLogBuilder(existingLog);
    
    const log = b.entries;
    assert.strictEqual(log.length, 2);
    assert.strictEqual(log[0].text, 'Existing user message');
    assert.strictEqual(log[1].text, 'Existing assistant response');
  });

  test('should append reasoning from finalizeStream', () => {
    builder.apply({ command: 'finalizeStream', text: '', reasoning: 'Thinking...' });
    
    const log = builder.entries;
    assert.strictEqual(log[0].type, 'assistant');
     
    assert.strictEqual((log[0] as any).reasoning, 'Thinking...');
  });

  test('should add tool call and result', () => {
    builder.apply({ command: 'finalizeStream', text: 'Hi' });
    builder.apply({ 
      command: 'toolStart', 
      toolCallId: 'call_1', 
      toolName: 'myTool', 
      args: '{"foo": "bar"}' 
    });
    
    let log = builder.entries;
     
    let tc = (log[0] as any).toolCalls;
    assert.ok(tc);
    assert.strictEqual(tc.length, 1);
    assert.strictEqual(tc[0].id, 'call_1');
    assert.strictEqual(tc[0].result, undefined);
    
    builder.apply({
      command: 'toolResult',
      toolCallId: 'call_1',
      result: 'Success!'
    });
    
    log = builder.entries;
     
    tc = (log[0] as any).toolCalls;
    assert.strictEqual(tc[0].result, 'Success!');
  });
});
