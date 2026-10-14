import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ToolExecutor } from '../tools';
import { SidebarProvider } from '../providers/SidebarProvider';
import { SessionStore } from '../history/sessionStore';

suite('ToolExecutor - Workspace path containment', () => {
  const root = path.join(os.tmpdir(), 'ooasis-containment');
  const executor = new ToolExecutor(root);
  const resolve = (p: string): string =>
    (executor as unknown as { resolveWorkspacePath: (p: string) => string }).resolveWorkspacePath(p);

  teardown(() => executor.dispose());

  test('allows relative paths inside the workspace', () => {
    assert.strictEqual(resolve('a/b.txt'), path.join(root, 'a', 'b.txt'));
    assert.strictEqual(resolve('.'), root);
  });

  test('allows absolute paths inside the workspace', () => {
    assert.strictEqual(resolve(path.join(root, 'x.txt')), path.join(root, 'x.txt'));
  });

  test('rejects relative traversal', () => {
    assert.throws(() => resolve('../secret.env'), /outside the workspace/);
    assert.throws(() => resolve('a/../../secret.env'), /outside the workspace/);
  });

  test('rejects absolute paths outside the workspace', () => {
    assert.throws(() => resolve(path.resolve(root, '..', 'other')), /outside the workspace/);
    assert.throws(() => resolve(path.parse(root).root), /outside the workspace/);
  });

  test('read_file reports access denied instead of reading', async () => {
    const result = await executor.execute('read_file', JSON.stringify({ path: '../../etc/passwd' }));
    assert.ok(result.includes('Access denied'), result);
  });
});

suite('SidebarProvider - openFile path containment', () => {
  const root = path.join(os.tmpdir(), 'ooasis-containment');
  const mockStorageUri = vscode.Uri.file(path.join(root, 'storage'));
  const sessionStore = new SessionStore(mockStorageUri, () => 100);
  const mockOutputChannel = {
    name: 'Mock',
    append: () => {},
    appendLine: () => {},
    replace: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
  } as unknown as vscode.OutputChannel;
  const provider = new SidebarProvider(vscode.Uri.file('/mock/ext'), sessionStore, mockOutputChannel);

  test('allows relative and absolute paths inside the workspace', () => {
    const resRel = provider.validateOpenFilePath('src/index.ts', root);
    assert.strictEqual(resRel.allowed, true);
    assert.strictEqual(resRel.absPath, path.join(root, 'src', 'index.ts'));

    const resAbs = provider.validateOpenFilePath(path.join(root, 'src', 'index.ts'), root);
    assert.strictEqual(resAbs.allowed, true);
    assert.strictEqual(resAbs.absPath, path.join(root, 'src', 'index.ts'));
  });

  test('rejects relative traversal outside workspace', () => {
    const res = provider.validateOpenFilePath('../secret.env', root);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error?.includes('outside the workspace'));
  });

  test('rejects absolute paths outside workspace', () => {
    const res = provider.validateOpenFilePath('/etc/passwd', root);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error?.includes('outside the workspace'));
  });

  test('rejects when workspaceRoot is undefined', () => {
    const res = provider.validateOpenFilePath('test.ts', undefined);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.error?.includes('No workspace open'));
  });
});
