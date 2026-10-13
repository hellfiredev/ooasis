import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ToolExecutor } from '../tools';
import { ReplaceInFileArgs } from '../types/chat';

suite('ToolExecutor - replaceInFile Test Suite', () => {
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

  suite('Basic Line Replacement', () => {
    test('should replace a single line in the middle of a file', async () => {
      const fileName = 'test-single.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 2,
        end_line: 2,
        content: 'line 2 updated',
      });

      assert.strictEqual(result, `Successfully replaced lines 2 to 2 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nline 2 updated\nline 3');
    });

    test('should replace multiple lines with a single line (line reduction)', async () => {
      const fileName = 'test-reduce.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3\nline 4\nline 5');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 2,
        end_line: 4,
        content: 'replacement for 2-4',
      });

      assert.strictEqual(result, `Successfully replaced lines 2 to 4 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nreplacement for 2-4\nline 5');
    });

    test('should replace a single line with multiple lines (line expansion)', async () => {
      const fileName = 'test-expand.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 2,
        end_line: 2,
        content: 'expanded A\nexpanded B\nexpanded C',
      });

      assert.strictEqual(result, `Successfully replaced lines 2 to 2 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nexpanded A\nexpanded B\nexpanded C\nline 3');
    });

    test('should replace the entire file content when range covers all lines', async () => {
      const fileName = 'test-entire.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 1,
        end_line: 3,
        content: 'brand new file content',
      });

      assert.strictEqual(result, `Successfully replaced lines 1 to 3 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'brand new file content');
    });

    test('should replace target lines with an empty string resulting in an empty line', async () => {
      const fileName = 'test-empty.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 2,
        end_line: 2,
        content: '',
      });

      assert.strictEqual(result, `Successfully replaced lines 2 to 2 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\n\nline 3');
    });
  });

  suite('Line Endings (CRLF vs LF)', () => {
    test('should preserve CRLF line endings when the original file uses CRLF', async () => {
      const fileName = 'test-crlf.txt';
      await writeTestFile(fileName, 'line 1\r\nline 2\r\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 2,
        end_line: 2,
        content: 'line 2 crlf',
      });

      assert.strictEqual(result, `Successfully replaced lines 2 to 2 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\r\nline 2 crlf\r\nline 3');
    });

    test('should correctly join multi-line replacement with CRLF when file uses CRLF', async () => {
      const fileName = 'test-crlf-multi.txt';
      await writeTestFile(fileName, 'line 1\r\nline 2\r\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 2,
        end_line: 2,
        content: 'part A\npart B',
      });

      assert.strictEqual(result, `Successfully replaced lines 2 to 2 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\r\npart A\r\npart B\r\nline 3');
    });

    test('should preserve LF line endings when the original file uses LF', async () => {
      const fileName = 'test-lf.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 1,
        end_line: 1,
        content: 'line 1 lf',
      });

      assert.strictEqual(result, `Successfully replaced lines 1 to 1 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1 lf\nline 2\nline 3');
    });
  });

  suite('Boundary Clamping and Range Normalization', () => {
    test('should clamp start_line <= 0 to 1', async () => {
      const fileName = 'test-clamp-zero.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 0,
        end_line: 1,
        content: 'new first line',
      });

      assert.strictEqual(result, `Successfully replaced lines 1 to 1 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'new first line\nline 2\nline 3');
    });

    test('should clamp negative start_line to 1', async () => {
      const fileName = 'test-clamp-neg.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: -5,
        end_line: 1,
        content: 'negative start fixed',
      });

      assert.strictEqual(result, `Successfully replaced lines 1 to 1 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'negative start fixed\nline 2\nline 3');
    });

    test('should clamp end_line exceeding total line count to lines.length', async () => {
      const fileName = 'test-clamp-end.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 2,
        end_line: 999,
        content: 'new tail',
      });

      assert.strictEqual(result, `Successfully replaced lines 2 to 3 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nnew tail');
    });

    test('should normalize inverted range (start_line > end_line) by pinning end to start', async () => {
      const fileName = 'test-inverted.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3\nline 4\nline 5');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 3,
        end_line: 1,
        content: 'line 3 replaced',
      });

      assert.strictEqual(result, `Successfully replaced lines 3 to 3 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\nline 2\nline 3 replaced\nline 4\nline 5');
    });
  });

  suite('Path Resolution', () => {
    test('should resolve relative path against workspace root', async () => {
      const fileName = 'subdir/nested.txt';
      await writeTestFile(fileName, 'nested content');

      const result = await callReplaceInFile({
        path: fileName,
        start_line: 1,
        end_line: 1,
        content: 'updated nested',
      });

      assert.strictEqual(result, `Successfully replaced lines 1 to 1 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'updated nested');
    });

    test('should resolve absolute path directly', async () => {
      const fileName = 'abs-test.txt';
      const fileUri = await writeTestFile(fileName, 'abs content');

      const result = await callReplaceInFile({
        path: fileUri.fsPath,
        start_line: 1,
        end_line: 1,
        content: 'updated abs',
      });

      assert.strictEqual(result, `Successfully replaced lines 1 to 1 in "${fileUri.fsPath}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'updated abs');
    });
  });

  suite('Error Handling', () => {
    test('should return error message when file does not exist', async () => {
      const result = await callReplaceInFile({
        path: 'non-existent-file-12345.txt',
        start_line: 1,
        end_line: 1,
        content: 'irrelevant',
      });

      assert.ok(result.startsWith('Error replacing in file "non-existent-file-12345.txt":'));
    });
  });

  suite('ToolExecutor.execute Dispatch Integration', () => {
    test('should successfully execute replace_in_file via tool dispatcher with JSON arguments', async () => {
      const fileName = 'test-dispatch.txt';
      await writeTestFile(fileName, 'line 1\nline 2\nline 3');

      const args: ReplaceInFileArgs = {
        path: fileName,
        start_line: 2,
        end_line: 2,
        content: 'dispatched line 2',
      };

      const result = await executor.execute('replace_in_file', JSON.stringify(args));

      assert.strictEqual(result, `Successfully replaced lines 2 to 2 in "${fileName}".`);
      const updated = await readTestFile(fileName);
      assert.strictEqual(updated, 'line 1\ndispatched line 2\nline 3');
    });

    test('should return error when execute receives malformed JSON arguments', async () => {
      const result = await executor.execute('replace_in_file', '{ bad json ');
      assert.ok(result.startsWith('Error executing tool "replace_in_file":'));
    });
  });
});
