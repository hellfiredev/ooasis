import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { ToolExecutor } from '../tools';

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
