import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ToolExecutor } from '../tools';

suite('Terminal Confirmation Test Suite', () => {
  let tempDirPath: string;
  let executor: ToolExecutor;
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;

  suiteSetup(async () => {
    tempDirPath = path.join(os.tmpdir(), `ooasis-term-test-${Date.now()}`);
    const tempDirUri = vscode.Uri.file(tempDirPath);
    await vscode.workspace.fs.createDirectory(tempDirUri);
    executor = new ToolExecutor(tempDirPath);

    // Save original function for restoration
    originalShowWarningMessage = vscode.window.showWarningMessage;
  });

  suiteTeardown(async () => {
    // Restore original function
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    executor.dispose();
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(tempDirPath), { recursive: true, useTrash: false });
    } catch {
      // Ignore teardown cleanup error
    }
  });

  teardown(() => {
    // Restore after each test
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  });

  test('should execute command when user allows it', async () => {
    // Stub showWarningMessage to return 'Allow'
    (vscode.window as any).showWarningMessage = async (): Promise<string | undefined> => {
      return 'Allow';
    };

    const result = await executor.execute('run_terminal', JSON.stringify({
      command: 'echo "hello"'
    }));

    assert.ok(result.includes('hello'), `Expected output to contain "hello", got: ${result}`);
  });

  test('should deny command when user clicks Deny', async () => {
    // Stub showWarningMessage to return 'Deny'
    (vscode.window as any).showWarningMessage = async (): Promise<string | undefined> => {
      return 'Deny';
    };

    const result = await executor.execute('run_terminal', JSON.stringify({
      command: 'echo "should not run"'
    }));

    assert.strictEqual(result, 'Command denied by user.');
  });

  test('should deny command when user dismisses dialog (undefined)', async () => {
    // Stub showWarningMessage to return undefined (user pressed Escape or closed dialog)
    (vscode.window as any).showWarningMessage = async (): Promise<string | undefined> => {
      return undefined;
    };

    const result = await executor.execute('run_terminal', JSON.stringify({
      command: 'echo "should not run"'
    }));

    assert.strictEqual(result, 'Command denied by user.');
  });

  test('confirmation dialog should receive the command text', async () => {
    let receivedMessage: string = '';

    (vscode.window as any).showWarningMessage = async (message: string): Promise<string | undefined> => {
      receivedMessage = message;
      return 'Deny'; // Deny to avoid actually running
    };

    await executor.execute('run_terminal', JSON.stringify({
      command: 'npm test'
    }));

    assert.ok(
      receivedMessage.includes('npm test'),
      `Expected dialog message to include "npm test", got: "${receivedMessage}"`
    );
  });
});
