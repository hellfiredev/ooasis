import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface SandboxOptions {
  /**
   * Whether the sandbox validation and containment is active.
   * Default: true.
   */
  enabled?: boolean;

  /**
   * Whether commands are permitted to write to system temporary directories (/tmp, os.tmpdir()).
   * Default: false (all modifications must be strictly inside the workspace).
   */
  allowTempDirectory?: boolean;

  /**
   * Additional absolute paths explicitly allowed for writing.
   */
  customAllowedPaths?: string[];
}

export interface SandboxValidationResult {
  allowed: boolean;
  reason?: string;
}

export interface PreparedCommand {
  command: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Sandboxes terminal commands to prevent accidental modification, deletion,
 * or creation of files outside the designated workspace root.
 */
export class TerminalSandbox {
  readonly workspaceRoot: string;
  private readonly _options: Required<SandboxOptions>;

  constructor(workspaceRoot: string, options?: SandboxOptions) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this._options = {
      enabled: options?.enabled ?? true,
      allowTempDirectory: options?.allowTempDirectory ?? false,
      customAllowedPaths: options?.customAllowedPaths ?? [],
    };
  }

  get isEnabled(): boolean {
    return this._options.enabled;
  }

  get allowTempDirectory(): boolean {
    return this._options.allowTempDirectory;
  }

  /**
   * Checks whether a target path is allowed for modification.
   * Virtual devices (/dev/null, etc.) and descriptor redirects (&1, &2) are always allowed.
   */
  isPathAllowed(targetPath: string, cwd: string): boolean {
    if (!targetPath) {
      return true;
    }

    const clean = targetPath.trim().replace(/^['"]|['"]$/g, '');

    // Allow virtual / null devices and file descriptor redirects (e.g. 2>&1)
    const virtualDevices = new Set(['/dev/null', '/dev/zero', '/dev/stdout', '/dev/stderr', '/dev/tty', 'nul', 'NUL']);
    if (virtualDevices.has(clean) || /^&\d+$/.test(clean)) {
      return true;
    }

    // Expand ~ or $HOME
    let expanded = clean;
    if (expanded === '~' || expanded.startsWith('~/')) {
      expanded = path.join(os.homedir(), expanded.slice(expanded === '~' ? 1 : 2));
    } else if (expanded === '$HOME' || expanded.startsWith('$HOME/')) {
      expanded = path.join(os.homedir(), expanded.slice(5));
    } else if (expanded === '${HOME}' || expanded.startsWith('${HOME}/')) {
      expanded = path.join(os.homedir(), expanded.slice(7));
    }

    const resolved = path.resolve(cwd, expanded);

    // 1. Must be inside workspace
    if (this._isSubpath(this.workspaceRoot, resolved)) {
      return true;
    }

    // 2. Or inside system temporary directory if explicitly allowed
    if (this._options.allowTempDirectory) {
      const systemTmp = path.resolve(os.tmpdir());
      if (this._isSubpath(systemTmp, resolved) || resolved === systemTmp) {
        return true;
      }
      if (process.platform === 'darwin' && (this._isSubpath('/private/tmp', resolved) || this._isSubpath('/tmp', resolved))) {
        return true;
      }
      if (process.platform === 'linux' && (this._isSubpath('/tmp', resolved) || this._isSubpath('/var/tmp', resolved))) {
        return true;
      }
    }

    // 3. Or in custom allowed paths
    return this._options.customAllowedPaths.some((p) => this._isSubpath(path.resolve(p), resolved));
  }

  private _isSubpath(parent: string, child: string): boolean {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
  }

  /**
   * Validates a command line string to verify that it does not attempt to modify
   * any files outside the workspace root.
   */
  validate(commandLine: string, cwd = this.workspaceRoot): SandboxValidationResult {
    if (!this._options.enabled || !commandLine?.trim()) {
      return { allowed: true };
    }

    // Fast check for catastrophic deletion of filesystem root or home
    if (/(?:^|\s)rm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(?:\/\*?|~|\$HOME|\$\{HOME\})(?:\s|$)/.test(commandLine)) {
      return { allowed: false, reason: 'Command attempts to delete filesystem root or user home directory.' };
    }

    const subCommands = this._splitChainedCommands(commandLine.trim());
    let currentVirtualCwd = cwd;

    for (const subCmd of subCommands) {
      const result = this._validateSingleCommand(subCmd, currentVirtualCwd);
      if (!result.allowed) {
        return result;
      }
      if (result.newVirtualCwd) {
        currentVirtualCwd = result.newVirtualCwd;
      }
    }

    return { allowed: true };
  }

  /**
   * Splits command chains (&&, ||, ;, |, &) while respecting quotes and parentheses.
   */
  private _splitChainedCommands(commandLine: string): string[] {
    const commands: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let parenDepth = 0;

    for (let i = 0; i < commandLine.length; i++) {
      const ch = commandLine[i];

      if (ch === '\\' && !inSingleQuote) {
        current += ch + (commandLine[++i] ?? '');
        continue;
      }
      if (ch === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (!inSingleQuote && !inDoubleQuote) {
        if (ch === '(') {
          parenDepth++;
        } else if (ch === ')' && parenDepth > 0) {
          parenDepth--;
        } else if (parenDepth === 0) {
          if (ch === ';' || ch === '\n') {
            if (current.trim()) { commands.push(current.trim()); }
            current = '';
            continue;
          }
          if ((ch === '&' && commandLine[i + 1] === '&') || (ch === '|' && commandLine[i + 1] === '|')) {
            if (current.trim()) { commands.push(current.trim()); }
            current = '';
            i++;
            continue;
          }
          if (ch === '|' || ch === '&') {
            if (current.trim()) { commands.push(current.trim()); }
            current = '';
            continue;
          }
        }
      }
      current += ch;
    }

    if (current.trim()) {
      commands.push(current.trim());
    }
    return commands;
  }

  /**
   * Tokenizes a command into argument words and output redirection targets (> / >>).
   */
  private _parseCommand(cmdStr: string): { args: string[]; redirects: string[] } {
    const args: string[] = [];
    const redirects: string[] = [];
    const tokenRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|((?:[12]|&)?(?:>>|>\||>))|(\S+)/g;
    let match: RegExpExecArray | null;
    let nextIsRedirect = false;

    while ((match = tokenRegex.exec(cmdStr)) !== null) {
      const [, doubleQ, singleQ, redirOp, bare] = match;

      if (redirOp) {
        nextIsRedirect = true;
        continue;
      }

      const token = doubleQ !== undefined
        ? doubleQ.replace(/\\(.)/g, '$1')
        : singleQ !== undefined
        ? singleQ
        : bare;

      if (nextIsRedirect) {
        redirects.push(token);
        nextIsRedirect = false;
      } else {
        args.push(token);
      }
    }

    return { args, redirects };
  }

  private _validateSingleCommand(
    cmdStr: string,
    currentCwd: string
  ): SandboxValidationResult & { newVirtualCwd?: string } {
    const trimmed = cmdStr.trim();
    if (!trimmed) {
      return { allowed: true };
    }

    // Unnest parenthesized subshells: (cmd1 && cmd2)
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      return this.validate(trimmed.slice(1, -1), currentCwd);
    }

    const { args, redirects } = this._parseCommand(trimmed);

    // 1. Output redirections (> output.txt, >> out.txt)
    for (const target of redirects) {
      if (!this.isPathAllowed(target, currentCwd)) {
        return { allowed: false, reason: `Output redirection to "${target}" targets a path outside the workspace.` };
      }
    }

    if (args.length === 0) {
      return { allowed: true };
    }

    const cmd = path.basename(args[0]);

    // 2. Directory changes (cd, pushd)
    if (cmd === 'cd' || cmd === 'pushd') {
      const target = args[1] ?? '~';
      const nextDir = target === '~' || target.startsWith('~/')
        ? path.join(os.homedir(), target.slice(target === '~' ? 1 : 2))
        : path.resolve(currentCwd, target);

      if (!this._isSubpath(this.workspaceRoot, nextDir)) {
        return { allowed: false, reason: `Directory change to "${args[1] || '~'}" navigates outside the workspace.` };
      }
      return { allowed: true, newVirtualCwd: nextDir };
    }

    // 3. Subshell / evaluation wrappers (bash -c, eval)
    if (['bash', 'sh', 'zsh', 'ksh'].includes(cmd)) {
      const cIdx = args.indexOf('-c');
      if (cIdx !== -1 && args[cIdx + 1]) {
        return this.validate(args[cIdx + 1], currentCwd);
      }
    }
    if (cmd === 'eval') {
      return this.validate(args.slice(1).join(' '), currentCwd);
    }

    // 4. Global package manager installs
    if (cmd === 'npm' && ['install', 'i', 'add', 'uninstall', 'rm', 'update'].includes(args[1])) {
      if (args.some((a) => a === '-g' || a === '--global')) {
        return { allowed: false, reason: 'Global package installation (npm -g) modifies files outside the workspace.' };
      }
    }
    if ((cmd === 'yarn' && args[1] === 'global') || (cmd === 'pnpm' && args.some((a) => a === '-g' || a === '--global'))) {
      return { allowed: false, reason: `Global package installation (${cmd} global) modifies files outside the workspace.` };
    }
    if ((cmd === 'pip' || cmd === 'pip3') && args.includes('--user')) {
      return { allowed: false, reason: 'pip install --user modifies files in user home outside the workspace.' };
    }
    if (cmd === 'cargo' && args[1] === 'install') {
      return { allowed: false, reason: 'cargo install modifies binaries in ~/.cargo outside the workspace.' };
    }

    // 5. Git global config / outside clone
    if (cmd === 'git') {
      if (args[1] === 'config' && (args.includes('--global') || args.includes('--system'))) {
        return { allowed: false, reason: 'git config --global / --system modifies configuration outside the workspace.' };
      }
      if (args[1] === 'clone' && args.length >= 4) {
        const targetDir = args[args.length - 1];
        if (!targetDir.startsWith('-') && !this.isPathAllowed(targetDir, currentCwd)) {
          return { allowed: false, reason: `git clone target directory "${targetDir}" is outside the workspace.` };
        }
      }
      if (args[1] === 'worktree' && args[2] === 'add' && args[3] && !this.isPathAllowed(args[3], currentCwd)) {
        return { allowed: false, reason: `git worktree add path "${args[3]}" is outside the workspace.` };
      }
    }

    // 6. Direct file modifying commands
    const MODIFY_COMMANDS = new Set([
      'rm', 'unlink', 'rmdir', 'srm', 'shred', 'wipe',
      'touch', 'mkdir', 'truncate', 'install',
      'cp', 'mv', 'ln', 'rename',
      'chmod', 'chown', 'chgrp',
      'tee',
    ]);

    if (MODIFY_COMMANDS.has(cmd)) {
      const fileArgs = args.slice(1).filter((a) => !a.startsWith('-'));
      for (const arg of fileArgs) {
        // Skip chmod/chown mode/owner tokens if not paths
        if (cmd === 'chmod' && (/^[0-7]+$/.test(arg) || /^[ugoa]*[-+=][rwxXst]*$/.test(arg))) {
          continue;
        }
        if ((cmd === 'chown' || cmd === 'chgrp') && /^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)?$/.test(arg)) {
          continue;
        }

        if (!this.isPathAllowed(arg, currentCwd)) {
          const actionMsg = cmd === 'tee' ? 'tee writes to path' : `Command "${cmd}" attempts to modify path`;
          return { allowed: false, reason: `${actionMsg} "${arg}" outside the workspace.` };
        }
      }
    }

    // 7. In-place / extraction flags (sed -i, perl -i, dd of=, tar -C, unzip -d)
    if ((cmd === 'sed' || cmd === 'perl') && args.some((a) => a.startsWith('-i') || a === '--in-place')) {
      const fileArgs = args.slice(1).filter((a) => !a.startsWith('-'));
      for (let idx = 0; idx < fileArgs.length; idx++) {
        const arg = fileArgs[idx];
        if ((idx > 0 || arg.includes('/') || arg.includes('.')) && !this.isPathAllowed(arg, currentCwd)) {
          return { allowed: false, reason: `In-place edit with "${cmd}" targets path "${arg}" outside the workspace.` };
        }
      }
    }

    if (cmd === 'dd') {
      const ofToken = args.find((a) => a.startsWith('of='));
      if (ofToken && !this.isPathAllowed(ofToken.slice(3), currentCwd)) {
        return { allowed: false, reason: `dd output file "${ofToken}" is outside the workspace.` };
      }
    }

    if (cmd === 'tar') {
      const cIdx = args.findIndex((a) => a === '-C' || a === '--directory');
      const dir = cIdx !== -1 ? args[cIdx + 1] : args.find((a) => a.startsWith('--directory='))?.split('=')[1];
      if (dir && !this.isPathAllowed(dir, currentCwd)) {
        return { allowed: false, reason: `tar extraction directory "${dir}" is outside the workspace.` };
      }
    }

    if (cmd === 'unzip') {
      const dIdx = args.indexOf('-d');
      if (dIdx !== -1 && args[dIdx + 1] && !this.isPathAllowed(args[dIdx + 1], currentCwd)) {
        return { allowed: false, reason: `unzip destination directory "${args[dIdx + 1]}" is outside the workspace.` };
      }
    }

    return { allowed: true };
  }

  /**
   * Prepares the command environment for execution, isolating temporary directories
   * and setting working directory environment variables.
   */
  prepareCommand(command: string, cwd: string): PreparedCommand {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PWD: cwd,
      INIT_CWD: cwd,
    };

    if (!this._options.allowTempDirectory) {
      const sandboxTmp = path.join(this.workspaceRoot, '.ooasis', 'tmp');
      try {
        if (!fs.existsSync(sandboxTmp)) {
          fs.mkdirSync(sandboxTmp, { recursive: true });
        }
        env.TMPDIR = sandboxTmp;
        env.TEMP = sandboxTmp;
        env.TMP = sandboxTmp;
      } catch {
        // Fall back gracefully
      }
    }

    return { command, env };
  }
}
