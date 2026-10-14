import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { TerminalSandbox } from '../sandbox/terminalSandbox';
import { ToolExecutor } from '../tools';

suite('Terminal Sandbox Test Suite', () => {
  const workspaceRoot = path.join(os.tmpdir(), 'ooasis-sandbox-test');
  let sandbox: TerminalSandbox;

  suiteSetup(() => {
    if (!fs.existsSync(workspaceRoot)) {
      fs.mkdirSync(workspaceRoot, { recursive: true });
    }
    sandbox = new TerminalSandbox(workspaceRoot);
  });

  suiteTeardown(() => {
    try {
      if (fs.existsSync(workspaceRoot)) {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  // ── 1. Path Containment Policy ─────────────────────────────────────────────

  suite('Path Allowed Policy', () => {
    test('allows paths within workspace', () => {
      assert.strictEqual(sandbox.isPathAllowed('src/index.ts', workspaceRoot), true);
      assert.strictEqual(sandbox.isPathAllowed('./file.txt', workspaceRoot), true);
      assert.strictEqual(sandbox.isPathAllowed(path.join(workspaceRoot, 'sub/dir/file.ts'), workspaceRoot), true);
    });

    test('rejects relative traversal outside workspace', () => {
      assert.strictEqual(sandbox.isPathAllowed('../../etc/passwd', workspaceRoot), false);
      assert.strictEqual(sandbox.isPathAllowed('../secret.env', workspaceRoot), false);
    });

    test('rejects absolute paths outside workspace', () => {
      assert.strictEqual(sandbox.isPathAllowed('/etc/passwd', workspaceRoot), false);
      assert.strictEqual(sandbox.isPathAllowed('/var/log/app.log', workspaceRoot), false);
    });

    test('allows virtual and null devices', () => {
      assert.strictEqual(sandbox.isPathAllowed('/dev/null', workspaceRoot), true);
      assert.strictEqual(sandbox.isPathAllowed('/dev/zero', workspaceRoot), true);
      assert.strictEqual(sandbox.isPathAllowed('/dev/stdout', workspaceRoot), true);
      assert.strictEqual(sandbox.isPathAllowed('/dev/stderr', workspaceRoot), true);
    });

    test('allows file descriptor references', () => {
      assert.strictEqual(sandbox.isPathAllowed('&1', workspaceRoot), true);
      assert.strictEqual(sandbox.isPathAllowed('&2', workspaceRoot), true);
    });

    test('disallows system temporary directory by default', () => {
      assert.strictEqual(sandbox.isPathAllowed(path.join(os.tmpdir(), 'scratch.txt'), workspaceRoot), false);
    });

    test('allows system temporary directory when allowTempDirectory is true', () => {
      const tempSandbox = new TerminalSandbox(workspaceRoot, { allowTempDirectory: true });
      assert.strictEqual(tempSandbox.isPathAllowed(path.join(os.tmpdir(), 'scratch.txt'), workspaceRoot), true);
    });

    test('allows custom allowed paths when configured', () => {
      const customDir = path.join(os.tmpdir(), 'ooasis-custom-dir');
      const customSandbox = new TerminalSandbox(workspaceRoot, {
        customAllowedPaths: [customDir],
      });
      assert.strictEqual(customSandbox.isPathAllowed(path.join(customDir, 'file.txt'), workspaceRoot), true);
      assert.strictEqual(customSandbox.isPathAllowed('/etc/hosts', workspaceRoot), false);
    });
  });

  // ── 2. Command Validation - Allowed Commands ──────────────────────────────

  suite('Command Validation - Allowed Commands', () => {
    test('allows read-only commands', () => {
      assert.strictEqual(sandbox.validate('echo "hello world"').allowed, true);
      assert.strictEqual(sandbox.validate('cat package.json').allowed, true);
      assert.strictEqual(sandbox.validate('grep "test" README.md').allowed, true);
      assert.strictEqual(sandbox.validate('git status').allowed, true);
      assert.strictEqual(sandbox.validate('git diff').allowed, true);
      assert.strictEqual(sandbox.validate('python -c "print(1)"').allowed, true);
    });

    test('allows file modifications strictly inside workspace', () => {
      assert.strictEqual(sandbox.validate('mkdir -p src/components').allowed, true);
      assert.strictEqual(sandbox.validate('touch src/components/Button.tsx').allowed, true);
      assert.strictEqual(sandbox.validate('rm file.txt').allowed, true);
      assert.strictEqual(sandbox.validate('rm -rf dist').allowed, true);
      assert.strictEqual(sandbox.validate('echo "hello" > output.txt').allowed, true);
      assert.strictEqual(sandbox.validate('echo "line" >> ./src/log.txt').allowed, true);
      assert.strictEqual(sandbox.validate('sed "s/foo/bar/" README.md').allowed, true);
      assert.strictEqual(sandbox.validate('sed -i "s/foo/bar/" README.md').allowed, true);
    });

    test('allows safe command chains and subshells within workspace', () => {
      assert.strictEqual(sandbox.validate('mkdir -p build && cd build && touch out.txt').allowed, true);
      assert.strictEqual(sandbox.validate('cd src && cd .. && npm test').allowed, true);
      assert.strictEqual(sandbox.validate('(touch sub.txt && rm sub.txt)').allowed, true);
      assert.strictEqual(sandbox.validate('bash -c "echo hello > test.txt"').allowed, true);
      assert.strictEqual(sandbox.validate('cmd 2>&1 > /dev/null').allowed, true);
    });

    test('allows local package manager commands', () => {
      assert.strictEqual(sandbox.validate('npm install lodash').allowed, true);
      assert.strictEqual(sandbox.validate('npm test').allowed, true);
      assert.strictEqual(sandbox.validate('yarn add express').allowed, true);
      assert.strictEqual(sandbox.validate('pnpm build').allowed, true);
    });

    test('allows local git configuration', () => {
      assert.strictEqual(sandbox.validate('git config user.name "Developer"').allowed, true);
      assert.strictEqual(sandbox.validate('git config user.email "dev@example.com"').allowed, true);
    });
  });

  // ── 3. Command Validation - Blocked Violations ─────────────────────────────

  suite('Command Validation - Blocked Violations', () => {
    test('blocks redirection targeting outside files', () => {
      const res1 = sandbox.validate('echo "test" > /etc/passwd');
      assert.strictEqual(res1.allowed, false);
      assert.ok(res1.reason?.includes('Output redirection'), res1.reason);

      const res2 = sandbox.validate('echo "test" >> ../../secret.txt');
      assert.strictEqual(res2.allowed, false);
      assert.ok(res2.reason?.includes('Output redirection'), res2.reason);
    });

    test('blocks catastrophic root and home deletion', () => {
      assert.strictEqual(sandbox.validate('rm -rf /').allowed, false);
      assert.strictEqual(sandbox.validate('rm -rf /*').allowed, false);
      assert.strictEqual(sandbox.validate('rm -rf ~').allowed, false);
      assert.strictEqual(sandbox.validate('rm -rf $HOME').allowed, false);
    });

    test('blocks file modifying commands targeting outside paths', () => {
      const commands = [
        'rm -rf /etc/hosts',
        'rm ../../secret.env',
        'touch /var/log/app.log',
        'mkdir /outside_dir',
        'mv file.txt /outside/file.txt',
        'cp file.txt ../../outside.txt',
        'chmod 777 /etc/passwd',
        'chown root /etc/shadow',
      ];

      for (const cmd of commands) {
        const res = sandbox.validate(cmd);
        assert.strictEqual(res.allowed, false, `Expected "${cmd}" to be blocked`);
        assert.ok(res.reason?.includes('outside the workspace'), `Expected outside workspace reason for "${cmd}", got: ${res.reason}`);
      }
    });

    test('blocks destructive streaming commands targeting outside paths', () => {
      const res1 = sandbox.validate('echo "bad" | tee /etc/hosts');
      assert.strictEqual(res1.allowed, false);
      assert.ok(res1.reason?.includes('tee writes to path'), res1.reason);

      const res2 = sandbox.validate('sed -i "s/a/b/" /etc/hosts');
      assert.strictEqual(res2.allowed, false);
      assert.ok(res2.reason?.includes('In-place edit'), res2.reason);

      const res3 = sandbox.validate('dd if=/dev/zero of=/dev/sda');
      assert.strictEqual(res3.allowed, false);
      assert.ok(res3.reason?.includes('dd output file'), res3.reason);
    });

    test('blocks directory traversal outside workspace', () => {
      const res1 = sandbox.validate('cd /etc && rm hosts');
      assert.strictEqual(res1.allowed, false);
      assert.ok(res1.reason?.includes('Directory change'), res1.reason);

      const res2 = sandbox.validate('cd .. && cd .. && rm something');
      assert.strictEqual(res2.allowed, false);
      assert.ok(res2.reason?.includes('Directory change'), res2.reason);
    });

    test('blocks global package installations', () => {
      const commands = [
        'npm install -g malicious-pkg',
        'npm i -g something',
        'yarn global add bad-pkg',
        'pnpm add -g bad-pkg',
        'pip install --user bad-pkg',
        'cargo install bad-crate',
      ];

      for (const cmd of commands) {
        const res = sandbox.validate(cmd);
        assert.strictEqual(res.allowed, false, `Expected global install "${cmd}" to be blocked`);
      }
    });

    test('blocks git global / system configuration', () => {
      const res1 = sandbox.validate('git config --global user.name "evil"');
      assert.strictEqual(res1.allowed, false);
      assert.ok(res1.reason?.includes('git config --global'), res1.reason);

      const res2 = sandbox.validate('git config --system user.email "evil@evil.com"');
      assert.strictEqual(res2.allowed, false);
      assert.ok(res2.reason?.includes('git config --global / --system'), res2.reason);
    });

    test('blocks wrapper subshells executing outside modifications', () => {
      const res = sandbox.validate('bash -c "rm /etc/passwd"');
      assert.strictEqual(res.allowed, false);
      assert.ok(res.reason?.includes('Command "rm" attempts to modify path'), res.reason);
    });

    test('allows commands when sandbox is disabled', () => {
      const disabledSandbox = new TerminalSandbox(workspaceRoot, { enabled: false });
      assert.strictEqual(disabledSandbox.validate('rm -rf /etc/hosts').allowed, true);
    });
  });

  // ── 4. ToolExecutor Integration ───────────────────────────────────────────

  suite('ToolExecutor Integration with Sandbox', () => {
    let confirmationAsked = false;
    let executor: ToolExecutor;

    setup(() => {
      confirmationAsked = false;
      executor = new ToolExecutor(workspaceRoot, async () => {
        confirmationAsked = true;
        return true;
      });
    });

    teardown(() => {
      executor.dispose();
    });

    test('blocks execution and skips confirmation on sandbox violation', async () => {
      const result = await executor.execute('run_terminal', JSON.stringify({
        command: 'rm -rf /etc/hosts',
      }));

      assert.ok(result.startsWith('Error: Sandbox violation:'), `Expected sandbox error, got: ${result}`);
      assert.strictEqual(confirmationAsked, false, 'User confirmation should NOT be called for blocked command');
    });

    test('blocks redirection outside workspace before confirmation', async () => {
      const result = await executor.execute('run_terminal', JSON.stringify({
        command: 'echo "evil" > /etc/passwd',
      }));

      assert.ok(result.startsWith('Error: Sandbox violation:'), `Expected sandbox error, got: ${result}`);
      assert.strictEqual(confirmationAsked, false, 'User confirmation should NOT be called for blocked command');
    });

    test('allows safe command to execute after user confirmation', async () => {
      const result = await executor.execute('run_terminal', JSON.stringify({
        command: 'echo "sandbox test passed"',
      }));

      assert.strictEqual(confirmationAsked, true, 'User confirmation should be called for safe command');
      assert.ok(result.includes('sandbox test passed'), `Expected output to include stdout, got: ${result}`);
    });

    test('prepareCommand sets working directory and sandbox temp environment', () => {
      const prepared = executor.sandbox.prepareCommand('echo test', workspaceRoot);
      assert.strictEqual(prepared.command, 'echo test');
      assert.strictEqual(prepared.env?.PWD, workspaceRoot);
      assert.strictEqual(prepared.env?.INIT_CWD, workspaceRoot);
      assert.ok(prepared.env?.TMPDIR?.includes(workspaceRoot), 'TMPDIR should be scoped to workspace');
    });
  });
});
