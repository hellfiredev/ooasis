import { vscode } from './vscodeApi';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export function safeSerialize(arg: unknown, depth = 0, seen = new WeakSet()): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
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
    if (seen.has(arg)) return '[Circular]';
    if (depth > 3) return '[Object]';
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

export function formatLogArgs(args: unknown[]): string {
  return args.map(arg => safeSerialize(arg)).join(' ');
}

export function setupWebviewLogging() {
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  let isLogging = false;

  const forwardLog = (level: LogLevel, args: unknown[]) => {
    if (isLogging) return;
    isLogging = true;
    try {
      const text = formatLogArgs(args);
      vscode.postMessage({
        command: 'log',
        level,
        text,
      });
    } catch {
      // Ignore serialization or postMessage failure
    } finally {
      isLogging = false;
    }
  };

  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);
      forwardLog(level, args);
    };
  });

  window.addEventListener('error', (event: ErrorEvent) => {
    const errorDetails = event.error || event.message;
    forwardLog('error', ['Uncaught Error:', errorDetails]);
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    forwardLog('error', ['Unhandled Promise Rejection:', event.reason]);
  });
}
