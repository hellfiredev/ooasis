import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ToolExecutor } from '../tools';
import { SearchWorkspaceArgs } from '../types/chat';

suite('ToolExecutor - searchWorkspace Test Suite', () => {
  let tempDirUri: vscode.Uri;
  let tempDirPath: string;
  let executor: ToolExecutor;

  // Helper to call private searchWorkspace directly
  const callSearchWorkspace = (args: SearchWorkspaceArgs): Promise<string> => {
    return (
      executor as unknown as {
        searchWorkspace: (a: SearchWorkspaceArgs) => Promise<string>;
      }
    ).searchWorkspace(args);
  };

  const writeTestFile = async (relPath: string, content: string | Buffer): Promise<vscode.Uri> => {
    const fileUri = vscode.Uri.file(path.join(tempDirPath, relPath));
    const parentDir = vscode.Uri.file(path.dirname(fileUri.fsPath));
    await vscode.workspace.fs.createDirectory(parentDir);
    const data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    await vscode.workspace.fs.writeFile(fileUri, data);
    return fileUri;
  };

  suiteSetup(async () => {
    tempDirPath = path.join(os.tmpdir(), `ooasis-search-${Date.now()}`);
    tempDirUri = vscode.Uri.file(tempDirPath);
    await vscode.workspace.fs.createDirectory(tempDirUri);
    executor = new ToolExecutor(tempDirPath);

    // Seed test files
    await writeTestFile(
      'src/moduleA.ts',
      'export const constant_1 = "ALPHA";\nconsole.log(constant_1);'
    );
    await writeTestFile(
      'src/moduleB.ts',
      'export const constant_2 = "BETA";\nconsole.log(constant_2);'
    );
    await writeTestFile('docs/guide.md', '# Documentation Guide\nSome constant_1 text here.');
    await writeTestFile(
      'node_modules/dep/index.js',
      'export const constant_1 = "SHOULD_BE_IGNORED";'
    );
    await writeTestFile('images/icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]));
  });

  suiteTeardown(async () => {
    try {
      await vscode.workspace.fs.delete(tempDirUri, { recursive: true, useTrash: false });
    } catch {
      // Ignore cleanup error
    }
    executor.dispose();
  });

  test('should return error if query is empty', async () => {
    const res = await callSearchWorkspace({ query: '' });
    assert.strictEqual(res, 'Error: Search query cannot be empty.');
  });

  test('should find literal text across files', async () => {
    const res = await callSearchWorkspace({ query: 'constant_1' });
    assert.ok(res.includes('Found 3 match(es) for "constant_1":'), `got: ${res}`);
    assert.ok(res.includes('src/moduleA.ts'), `expected moduleA, got: ${res}`);
    assert.ok(res.includes('docs/guide.md'), `expected guide.md, got: ${res}`);
  });

  test('should return no matches when string is not found', async () => {
    const res = await callSearchWorkspace({ query: 'non_existent_search_query_123' });
    assert.strictEqual(res, 'No matches found for "non_existent_search_query_123".');
  });

  test('should filter by include_pattern', async () => {
    const resTs = await callSearchWorkspace({ query: 'ALPHA', include_pattern: '*.ts' });
    assert.ok(resTs.includes('src/moduleA.ts'), `expected moduleA in ${resTs}`);
    assert.ok(!resTs.includes('docs/guide.md'), `unexpected docs in ${resTs}`);

    const resDocs = await callSearchWorkspace({ query: 'constant_1', include_pattern: 'docs/**' });
    assert.ok(resDocs.includes('docs/guide.md'), `expected guide.md in ${resDocs}`);
    assert.ok(!resDocs.includes('src/moduleA.ts'), `unexpected moduleA in ${resDocs}`);
  });

  test('should ignore matches in excluded dirs like node_modules', async () => {
    const res = await callSearchWorkspace({ query: 'SHOULD_BE_IGNORED' });
    assert.strictEqual(res, 'No matches found for "SHOULD_BE_IGNORED".');
  });

  test('should ignore binary files', async () => {
    const res = await callSearchWorkspace({ query: 'PNG' });
    assert.strictEqual(res, 'No matches found for "PNG".');
  });

  test('should support regex search', async () => {
    const res = await callSearchWorkspace({ query: 'constant_[12]', is_regex: true });
    assert.ok(res.includes('src/moduleA.ts'));
    assert.ok(res.includes('src/moduleB.ts'));
  });

  test('should return error for invalid regex pattern', async () => {
    const res = await callSearchWorkspace({ query: '[invalid(regex', is_regex: true });
    assert.ok(res.startsWith('Error: Invalid regular expression'));
  });

  test('should safely handle shell metacharacters without command execution', async () => {
    const maliciousQuery = '; rm -rf /tmp/test; $(echo injected); `whoami`';
    const res = await callSearchWorkspace({ query: maliciousQuery });
    assert.strictEqual(res, `No matches found for "${maliciousQuery}".`);
  });

  test('ToolExecutor.execute dispatch should execute search_workspace with JSON args', async () => {
    const res = await executor.execute(
      'search_workspace',
      JSON.stringify({ query: 'constant_1' })
    );
    assert.ok(res.includes('Found 3 match(es) for "constant_1":'));
  });
});
