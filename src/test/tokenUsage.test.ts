import * as assert from 'assert';

/**
 * Tests for the token usage tracking logic.
 * 
 * Since the actual logic runs in React state (webview),
 * we test the pure logic that drives the state updates.
 */
suite('Token Usage Tracking Test Suite', () => {

  // Reproduce the tracking logic from App.tsx's tokenUsage handler
  type TokenUsageState = { used: number; total: number } | null;

  function applyTokenUsage(
    prev: TokenUsageState,
    totalTokens: number,
    contextWindow: number
  ): TokenUsageState {
    return {
      used: totalTokens,
      total: contextWindow,
    };
  }

  function applyNewChat(prev: TokenUsageState): TokenUsageState {
    return prev ? { used: 0, total: prev.total } : null;
  }

  function applyModelInfo(contextWindow: number): TokenUsageState {
    return { used: 0, total: contextWindow };
  }

  suite('Basic tracking', () => {
    test('first usage message should set value', () => {
      const state = applyTokenUsage(null, 100, 8192);
      assert.deepStrictEqual(state, { used: 100, total: 8192 });
    });

    test('second usage message should replace previous usage', () => {
      let state: TokenUsageState = applyTokenUsage(null, 100, 8192);
      state = applyTokenUsage(state, 150, 8192);
      assert.deepStrictEqual(state, { used: 150, total: 8192 });
    });

    test('context window should be preserved', () => {
      let state: TokenUsageState = null;
      state = applyTokenUsage(state, 100, 32768);
      state = applyTokenUsage(state, 200, 32768);
      assert.strictEqual(state!.total, 32768);
    });
  });

  suite('New chat reset', () => {
    test('new chat should reset usage to 0 but keep total', () => {
      let state: TokenUsageState = applyTokenUsage(null, 500, 8192);
      assert.strictEqual(state!.used, 500);

      state = applyNewChat(state);
      assert.deepStrictEqual(state, { used: 0, total: 8192 });
    });

    test('tracking should start fresh after new chat', () => {
      let state: TokenUsageState = applyTokenUsage(null, 500, 8192);
      state = applyNewChat(state);
      state = applyTokenUsage(state, 100, 8192);
      assert.deepStrictEqual(state, { used: 100, total: 8192 });
    });
  });

  suite('Model info initialization', () => {
    test('model info should initialize with zero used tokens', () => {
      const state = applyModelInfo(32768);
      assert.deepStrictEqual(state, { used: 0, total: 32768 });
    });

    test('model info should reset any previous usage', () => {
      let state: TokenUsageState = applyTokenUsage(null, 500, 8192);
      state = applyModelInfo(32768);
      assert.deepStrictEqual(state, { used: 0, total: 32768 });
    });
  });
});
