import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ToolExecutor } from '../tools';

suite('Terminal Confirmation Test Suite', () => {
  let tempDirPath: string;
  let mockUserResponse: boolean = false;
  let receivedCommand: string = '';
  let executor: ToolExecutor;

  suiteSetup(async () => {
    tempDirPath = path.join(os.tmpdir(), `ooasis-term-test-${Date.now()}`);
    const tempDirUri = vscode.Uri.file(tempDirPath);
    await vscode.workspace.fs.createDirectory(tempDirUri);
    
    executor = new ToolExecutor(tempDirPath, async (command: string) => {
      receivedCommand = command;
      return mockUserResponse;
    });
  });

  suiteTeardown(async () => {
    executor.dispose();
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(tempDirPath), { recursive: true, useTrash: false });
    } catch {
      // Ignore teardown cleanup error
    }
  });

  teardown(() => {
    // Reset state after each test
    mockUserResponse = false;
    receivedCommand = '';
  });

  test('should execute command when user allows it', async () => {
    mockUserResponse = true;

    const result = await executor.execute('run_terminal', JSON.stringify({
      command: 'echo "hello"'
    }));

    assert.ok(result.includes('hello'), `Expected output to contain "hello", got: ${result}`);
  });

  test('should deny command when user clicks Deny', async () => {
    mockUserResponse = false;

    const result = await executor.execute('run_terminal', JSON.stringify({
      command: 'echo "should not run"'
    }));

    assert.strictEqual(result, 'Command denied by user.');
  });

  test('confirmation callback should receive the command text', async () => {
    mockUserResponse = false; // Deny to avoid actually running

    await executor.execute('run_terminal', JSON.stringify({
      command: 'npm test'
    }));

    assert.ok(
      receivedCommand.includes('npm test'),
      `Expected callback command to include "npm test", got: "${receivedCommand}"`
    );
  });
});

