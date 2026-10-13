import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ToolExecutor } from '../tools';
import { ReplaceInFileArgs } from '../types/chat';

suite('ToolExecutor - Hash-based replaceInFile Test Suite', () => {
  let tempDirUri: vscode.Uri;
  let tempDirPath: string;
  let executor: ToolExecutor;

  // Helper to call private replaceInFile directly
  const callReplaceInFile = (args: ReplaceInFileArgs): Promise<string> => {
    return (executor as unknown as { replaceInFile: (a: ReplaceInFileArgs) => Promise<string> }).replaceInFile(args);
  };

  // Helper to write a file in the temp workspace
  const writeTestFile = async (relPath: string, content: string): Promise<vscode.Uri> => {
    const fileUri = vscode.Uri.file(path.join(tempDirPath, relPath));
    const parentDir = vscode.Uri.file(path.dirname(fileUri.fsPath));
    await vscode.workspace.fs.createDirectory(parentDir);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    return fileUri;
  };

  // Helper to read back the file content
  const readTestFile = async (relPath: string): Promise<string> => {
    const fileUri = vscode.Uri.file(path.join(tempDirPath, relPath));
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(bytes).toString('utf-8');
  };

  // Helper to get hash for a specific line
  const getHash = (lineContent: string, lineNumber: number): string => {
    return ToolExecutor.hashLine(lineContent, lineNumber);
  };

  suiteSetup(async () => {
    tempDirPath = path.join(os.tmpdir(), `ooasis-test-${Date.now()}`);
    tempDirUri = vscode.Uri.file(tempDirPath);
    await vscode.workspace.fs.createDirectory(tempDirUri);
    executor = new ToolExecutor(tempDirPath);
  });

  suiteTeardown(async () => {
    try {
      await vscode.workspace.fs.delete(tempDirUri, { recursive: true, useTrash: false });
    } catch {
      // Ignore teardown cleanup error
    }
    executor.dispose();
  });

  suite('hashLine utility', () => {
    test('should return a 6-character hex string', () => {
      const hash = ToolExecutor.hashLine('hello world', 1);
      assert.strictEqual(hash.length, 6);
      assert.ok(/^[0-9a-f]{6}$/.test(hash), `Hash "${hash}" is not a valid 6-char hex string`);
    });

    test('should return different hashes for different content', () => {
      const hash1 = ToolExecutor.hashLine('line A', 1);
      const hash2 = ToolExecutor.hashLine('line B', 1);
      assert.notStrictEqual(hash1, hash2);
    });

    test('should return different hashes for same content at different line numbers', () => {
      const hash1 = ToolExecutor.hashLine('duplicate line', 1);
      const hash2 = ToolExecutor.hashLine('duplicate line', 2);
      assert.notStrictEqual(hash1, hash2, 'Same content at different line numbers should produce different hashes');
    });

    test('should be deterministic (same input = same output)', () => {
      const hash1 = ToolExecutor.hashLine('test content', 5);
      const hash2 = ToolExecutor.hashLine('test content', 5);
      assert.strictEqual(hash1, hash2);
    });
  });

  suite('read_file hash output', () => {
    test('read_file output should include hash prefixes for each line', async () => {
      const fileName = 'test-hash-output.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await executor.execute('read_file', JSON.stringify({ path: fileName }));

      // Each content line should start with a 6-char hash followed by ": "
      const codeBlockMatch = result.match(/```\n([\s\S]*?)\n```/);
      assert.ok(codeBlockMatch, 'Output should contain a code block');
      
      const contentLines = codeBlockMatch![1].split('\n');
      for (const line of contentLines) {
        assert.ok(
          /^[0-9a-f]{6}: /.test(line),
          `Line "${line}" does not start with a valid 6-char hash prefix`
        );
      }
    });
  });

  suite('Basic Hash-based Replacement', () => {
    test('should replace a single line by its hash', async () => {
      const fileName = 'test-hash-single.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const hash2 = getHash('line 2', 2);

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: hash2,
        end_hash: hash2,
        content: 'line 2 updated',
      });

      assert.ok(result.includes('Successfully replaced'));
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nline 2 updated\nline 3');
    });

    test('should replace multiple lines by hash range', async () => {
      const fileName = 'test-hash-multi.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3\nline 4\nline 5');

      const hash2 = getHash('line 2', 2);
      const hash4 = getHash('line 4', 4);

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: hash2,
        end_hash: hash4,
        content: 'replacement for 2-4',
      });

      assert.ok(result.includes('Successfully replaced'));
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nreplacement for 2-4\nline 5');
    });

    test('should expand a single line into multiple lines', async () => {
      const fileName = 'test-hash-expand.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const hash2 = getHash('line 2', 2);

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: hash2,
        end_hash: hash2,
        content: 'expanded A\nexpanded B\nexpanded C',
      });

      assert.ok(result.includes('Successfully replaced'));
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nexpanded A\nexpanded B\nexpanded C\nline 3');
    });

    test('should strip erroneously included hash prefixes from replacement content', async () => {
      const fileName = 'test-hash-strip.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const hash2 = getHash('line 2', 2);

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: hash2,
        end_hash: hash2,
        content: 'a1b2c3: line 2 updated\nxyz789: extra line',
      });

      assert.ok(result.includes('Successfully replaced'));
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nline 2 updated\nextra line\nline 3');
    });

    test('should replace entire file when hashes span all lines', async () => {
      const fileName = 'test-hash-entire.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const hash1 = getHash('line 1', 1);
      const hash3 = getHash('line 3', 3);

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: hash1,
        end_hash: hash3,
        content: 'brand new file content',
      });

      assert.ok(result.includes('Successfully replaced'));
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'brand new file content');
    });
  });

  suite('Error Handling', () => {
    test('should return error when start_hash is not found', async () => {
      const fileName = 'test-hash-notfound.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: 'abcdef',
        end_hash: getHash('line 3', 3),
        content: 'irrelevant',
      });

      assert.ok(result.includes('Could not find line matching hash "abcdef"'));
    });

    test('should return error when end_hash is not found', async () => {
      const fileName = 'test-hash-endnotfound.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: getHash('line 1', 1),
        end_hash: 'xxxxxx',
        content: 'irrelevant',
      });

      assert.ok(result.includes('Could not find line matching hash "xxxxxx"'));
    });

    test('should return error when start_hash comes after end_hash', async () => {
      const fileName = 'test-hash-inverted.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const hash1 = getHash('line 1', 1);
      const hash3 = getHash('line 3', 3);

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: hash3,
        end_hash: hash1,
        content: 'irrelevant',
      });

      assert.ok(result.includes('is after end_hash'));
    });

    test('should return error when file does not exist', async () => {
      const result = await callReplaceInFile({
        path: 'non-existent-file-12345.txt',
        start_hash: 'aaaaaa',
        end_hash: 'bbbbbb',
        content: 'irrelevant',
      });

      assert.ok(result.startsWith('Error replacing in file "non-existent-file-12345.txt":'));
    });
  });

  suite('Hash collision resistance (duplicate lines)', () => {
    test('should produce unique hashes for duplicate lines due to line number inclusion', () => {
      const content = 'duplicate line';
      const hash1 = ToolExecutor.hashLine(content, 1);
      const hash2 = ToolExecutor.hashLine(content, 2);
      const hash3 = ToolExecutor.hashLine(content, 3);

      const hashes = new Set([hash1, hash2, hash3]);
      assert.strictEqual(hashes.size, 3, 'All hashes should be unique despite identical content');
    });
  });

  suite('CRLF preservation', () => {
    test('should preserve CRLF line endings when replacing by hash', async () => {
      const fileName = 'test-hash-crlf.txt';
      await writeTestFile(fileName, 'line 1\r\nline 2\r\nline 3');

      // Note: hashes are computed from lines split by /\r?\n/, so content won't include \r
      const hash2 = getHash('line 2', 2);

      const result = await callReplaceInFile({
        path: fileName,
        start_hash: hash2,
        end_hash: hash2,
        content: 'line 2 crlf',
      });

      assert.ok(result.includes('Successfully replaced'));
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\r\nline 2 crlf\r\nline 3');
    });
  });

  suite('ToolExecutor.execute Dispatch Integration', () => {
    test('should successfully execute replace_in_file via tool dispatcher with hash-based JSON args', async () => {
      const fileName = 'test-hash-dispatch.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const hash2 = getHash('line 2', 2);

      const args: ReplaceInFileArgs = {
        path: fileName,
        start_hash: hash2,
        end_hash: hash2,
        content: 'dispatched line 2',
      };

      const result = await executor.execute('replace_in_file', JSON.stringify(args));

      assert.ok(result.includes('Successfully replaced'));
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\ndispatched line 2\nline 3');
    });

    test('should return error when execute receives malformed JSON arguments', async () => {
      const result = await executor.execute('replace_in_file', '{ bad json ');
      assert.ok(result.startsWith('Error executing tool "replace_in_file":'));
    });
  });
});
