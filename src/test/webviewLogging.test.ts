import * as assert from 'assert';
import * as vscode from 'vscode';
import { SidebarProvider } from '../providers/SidebarProvider';
import { SessionStore } from '../history/sessionStore';
import { WebviewLogLevel } from '../types/chat';

/**
 * Pure serialization logic mirroring webview-ui/src/logger.ts
 */
function safeSerialize(arg: unknown, depth = 0, seen = new WeakSet()): string {
  if (arg === null) { return 'null'; }
  if (arg === undefined) { return 'undefined'; }
  if (typeof arg === 'string') { return arg; }
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
    return String(arg);
  }
  if (typeof arg === 'symbol' || typeof arg === 'function') {
    return arg.toString();
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  if (typeof arg === 'object') {
    if (seen.has(arg)) { return '[Circular]'; }
    if (depth > 3) { return '[Object]'; }
    seen.add(arg);
    try {
      if (Array.isArray(arg)) {
        return '[' + arg.map(item => safeSerialize(item, depth + 1, seen)).join(', ') + ']';
      }
      const keys = Object.keys(arg);
      const entries = keys.map(k => `${k}: ${safeSerialize((arg as Record<string, unknown>)[k], depth + 1, seen)}`);
      return `{ ${entries.join(', ')} }`;
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

function formatLogArgs(args: unknown[]): string {
  return args.map(arg => safeSerialize(arg)).join(' ');
}

suite('Webview Logging Test Suite', () => {
  suite('safeSerialize & formatLogArgs', () => {
    test('serializes primitive values correctly', () => {
      assert.strictEqual(safeSerialize('hello'), 'hello');
      assert.strictEqual(safeSerialize(123), '123');
      assert.strictEqual(safeSerialize(true), 'true');
      assert.strictEqual(safeSerialize(false), 'false');
      assert.strictEqual(safeSerialize(null), 'null');
      assert.strictEqual(safeSerialize(undefined), 'undefined');
    });

    test('serializes Error objects with name, message and stack', () => {
      const err = new Error('test error message');
      const serialized = safeSerialize(err);
      assert.ok(serialized.includes('Error: test error message'), 'Should include error name and message');
      assert.ok(serialized.includes('at '), 'Should include stack trace');
    });

    test('serializes plain objects and arrays', () => {
      const obj = { name: 'Alice', age: 30, tags: ['admin', 'user'] };
      const serialized = safeSerialize(obj);
      assert.ok(serialized.includes('name: Alice'));
      assert.ok(serialized.includes('age: 30'));
      assert.ok(serialized.includes('tags: [admin, user]'));
    });

    test('handles circular references gracefully without throwing', () => {
      const a: Record<string, unknown> = { name: 'a' };
      const b: Record<string, unknown> = { name: 'b', ref: a };
      a.ref = b;

      const serialized = safeSerialize(a);
      assert.ok(serialized.includes('[Circular]'), 'Should contain [Circular] for recursive objects');
    });

    test('formats multiple arguments separated by spaces', () => {
      const formatted = formatLogArgs(['User logged in:', { id: 42 }, true]);
      assert.strictEqual(formatted, 'User logged in: { id: 42 } true');
    });
  });

  suite('SidebarProvider log handling', () => {
    test('handleWebviewLog appends to output channel and routes to console', () => {
      const appendedLines: string[] = [];
      const mockOutputChannel: vscode.OutputChannel = {
        name: 'Mock Channel',
        append: () => {},
        appendLine: (line: string) => { appendedLines.push(line); },
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      };

      const mockUri = vscode.Uri.file('/mock/extension');
      const mockStorageUri = vscode.Uri.file('/mock/storage');
      const sessionStore = new SessionStore(mockStorageUri, () => 100);
      const provider = new SidebarProvider(mockUri, sessionStore, mockOutputChannel);

      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      const originalConsoleInfo = console.info;
      const originalConsoleDebug = console.debug;

      const logged: { type: string; msg: string }[] = [];
      console.log = (...args: unknown[]) => { logged.push({ type: 'log', msg: args.join(' ') }); };
      console.error = (...args: unknown[]) => { logged.push({ type: 'error', msg: args.join(' ') }); };
      console.warn = (...args: unknown[]) => { logged.push({ type: 'warn', msg: args.join(' ') }); };
      console.info = (...args: unknown[]) => { logged.push({ type: 'info', msg: args.join(' ') }); };
      console.debug = (...args: unknown[]) => { logged.push({ type: 'debug', msg: args.join(' ') }); };

      try {
        const levels: WebviewLogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
        for (const lvl of levels) {
          provider.handleWebviewLog(lvl, `Sample message for ${lvl}`);
        }

        assert.strictEqual(appendedLines.length, 5);
        assert.ok(appendedLines[0].includes('[Webview][LOG] Sample message for log'));
        assert.ok(appendedLines[1].includes('[Webview][INFO] Sample message for info'));
        assert.ok(appendedLines[2].includes('[Webview][WARN] Sample message for warn'));
        assert.ok(appendedLines[3].includes('[Webview][ERROR] Sample message for error'));
        assert.ok(appendedLines[4].includes('[Webview][DEBUG] Sample message for debug'));

        assert.ok(logged.some(l => l.type === 'log' && l.msg.includes('[Webview][LOG] Sample message for log')));
        assert.ok(logged.some(l => l.type === 'info' && l.msg.includes('[Webview][INFO] Sample message for info')));
        assert.ok(logged.some(l => l.type === 'warn' && l.msg.includes('[Webview][WARN] Sample message for warn')));
        assert.ok(logged.some(l => l.type === 'error' && l.msg.includes('[Webview][ERROR] Sample message for error')));
        assert.ok(logged.some(l => l.type === 'debug' && l.msg.includes('[Webview][DEBUG] Sample message for debug')));
      } finally {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        console.info = originalConsoleInfo;
        console.debug = originalConsoleDebug;
      }
    });
  });
});
