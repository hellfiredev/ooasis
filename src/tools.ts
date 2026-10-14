import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  ReadFileArgs,
  WriteFileArgs,
  ReplaceInFileArgs,
  RunTerminalArgs,
  SearchWorkspaceArgs,
  ListDirectoryArgs,
} from './types/chat';

// ─── Tool Definitions (llama.cpp / OpenAI-compatible format) ─────────────────

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the content of a file in the workspace. Use this to inspect source code, configs, or any text file. Optionally specify start_line and end_line to read a specific range.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to the file, relative to the workspace root. Example: "src/extension.ts"',
          },
          start_line: {
            type: 'number',
            description: 'Optional 1-indexed line to start reading from.',
          },
          end_line: {
            type: 'number',
            description: 'Optional 1-indexed line to stop reading at (inclusive).',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write or overwrite a file in the workspace with the given content. Use for creating new files or replacing existing ones.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to the file relative to the workspace root. Example: "src/newModule.ts"',
          },
          content: {
            type: 'string',
            description: 'The complete content to write to the file.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description:
        'Update an existing file by replacing a specific block of lines identified by their hash prefixes. Use the hash values shown in read_file output (the 6-character prefix before each line). The lines from start_hash to end_hash (inclusive) will be replaced by the provided content. WARNING: Do NOT include the hash prefixes in the replacement content. Just provide the raw code.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to the file relative to the workspace root. Example: "src/extension.ts"',
          },
          start_hash: {
            type: 'string',
            description: 'The 6-character hash prefix of the first line to replace (from read_file output).',
          },
          end_hash: {
            type: 'string',
            description: 'The 6-character hash prefix of the last line to replace (from read_file output).',
          },
          content: {
            type: 'string',
            description: 'The replacement content.',
          },
        },
        required: ['path', 'start_hash', 'end_hash', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description:
        'Execute a shell command in the workspace. Use for running builds, tests, npm scripts, or any CLI tool. Avoid interactive commands.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to run. Example: "npm test" or "tsc --noEmit"',
          },
          cwd: {
            type: 'string',
            description:
              'Optional working directory relative to workspace root. Defaults to workspace root.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_workspace',
      description:
        'Search for a text pattern or regex across all files in the workspace. Returns file paths and matching lines with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The text or regex pattern to search for.',
          },
          include_pattern: {
            type: 'string',
            description:
              'Optional glob pattern to limit search to specific files. Example: "**/*.ts"',
          },
          is_regex: {
            type: 'boolean',
            description: 'If true, treat query as a regular expression. Default false.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'List files and subdirectories at a given path in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Directory path relative to the workspace root. Use "." for the root. Example: "src"',
          },
        },
        required: ['path'],
      },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

export class ToolExecutor {
  private _terminal: vscode.Terminal | undefined;

  constructor(
    private readonly _workspaceRoot: string | undefined,
    private readonly _askUserConfirmation?: (command: string) => Promise<boolean>
  ) {}

  async execute(toolName: string, argsJson: string): Promise<string> {
    try {
      const args = JSON.parse(argsJson);
      switch (toolName) {
        case 'read_file':
          return await this.readFile(args as ReadFileArgs);
        case 'write_file':
          return await this.writeFile(args as WriteFileArgs);
        case 'replace_in_file':
          return await this.replaceInFile(args as ReplaceInFileArgs);
        case 'run_terminal':
          return await this.runTerminal(args as RunTerminalArgs);
        case 'search_workspace':
          return await this.searchWorkspace(args as SearchWorkspaceArgs);
        case 'list_directory':
          return await this.listDirectory(args as ListDirectoryArgs);
        default:
          return `Error: Unknown tool "${toolName}"`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error executing tool "${toolName}": ${msg}`;
    }
  }

  // ── Hashing utility ────────────────────────────────────────────────────────

  /**
   * Generate a short 6-character hash for a line based on its content and
   * 1-indexed line number. Including the line number ensures uniqueness
   * even for duplicate lines.
   */
  static hashLine(lineContent: string, lineNumber: number): string {
    return crypto
      .createHash('sha256')
      .update(`${lineNumber}:${lineContent}`)
      .digest('hex')
      .slice(0, 6);
  }

  // ── read_file ──────────────────────────────────────────────────────────────

  private async readFile(args: ReadFileArgs): Promise<string> {
    const absPath = this.resolveWorkspacePath(args.path);
    const uri = vscode.Uri.file(absPath);

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(bytes).toString('utf-8');
      const lines = content.split('\n');

      const start = args.start_line ? Math.max(0, args.start_line - 1) : 0;
      const end = args.end_line ? Math.min(lines.length, args.end_line) : lines.length;

      const sliced = lines.slice(start, end);
      const numbered = sliced
        .map((line, i) => {
          const lineNum = start + i + 1;
          const hash = ToolExecutor.hashLine(line, lineNum);
          return `${hash}: ${line}`;
        })
        .join('\n');

      return `File: ${args.path} (lines ${start + 1}–${end})\n\`\`\`\n${numbered}\n\`\`\``;
    } catch {
      return `Error: Could not read file "${args.path}". Make sure it exists in the workspace.`;
    }
  }

  // ── replace_in_file ────────────────────────────────────────────────────────

  private async replaceInFile(args: ReplaceInFileArgs): Promise<string> {
    const absPath = this.resolveWorkspacePath(args.path);
    const uri = vscode.Uri.file(absPath);

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const fileContent = Buffer.from(bytes).toString('utf-8');
      
      const isCrlf = fileContent.includes('\r\n');
      const lines = fileContent.split(/\r?\n/);
      const replacementLines = args.content.split(/\r?\n/).map(line => {
        // Strip potential hash prefixes (e.g. "a1b2c3: ") if the LLM incorrectly included them
        const match = line.match(/^[0-9a-f]{6}: (.*)$/);
        return match ? match[1] : line;
      });

      // Build hash map: hash -> line index (0-based)
      const hashToIndex = new Map<string, number>();
      for (let i = 0; i < lines.length; i++) {
        const hash = ToolExecutor.hashLine(lines[i], i + 1);
        if (!hashToIndex.has(hash)) {
          hashToIndex.set(hash, i);
        }
      }

      const startIdx = hashToIndex.get(args.start_hash);
      const endIdx = hashToIndex.get(args.end_hash);

      if (startIdx === undefined) {
        return `Error: Could not find line matching hash "${args.start_hash}" in "${args.path}". Re-read the file to get current hashes.`;
      }
      if (endIdx === undefined) {
        return `Error: Could not find line matching hash "${args.end_hash}" in "${args.path}". Re-read the file to get current hashes.`;
      }
      if (startIdx > endIdx) {
        return `Error: start_hash "${args.start_hash}" (line ${startIdx + 1}) is after end_hash "${args.end_hash}" (line ${endIdx + 1}) in "${args.path}".`;
      }

      // Replace the range
      lines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines);
      
      const newContent = lines.join(isCrlf ? '\r\n' : '\n');
      const newBytes = Buffer.from(newContent, 'utf-8');
      await vscode.workspace.fs.writeFile(uri, newBytes);

      // Open in editor so user sees what was written
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

      return `Successfully replaced lines ${startIdx + 1} to ${endIdx + 1} in "${args.path}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error replacing in file "${args.path}": ${msg}`;
    }
  }

  // ── write_file ─────────────────────────────────────────────────────────────

  private async writeFile(args: WriteFileArgs): Promise<string> {
    const absPath = this.resolveWorkspacePath(args.path);
    const uri = vscode.Uri.file(absPath);

    try {
      const bytes = Buffer.from(args.content, 'utf-8');
      await vscode.workspace.fs.writeFile(uri, bytes);

      // Open in editor so user sees what was written
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

      const lineCount = args.content.split('\n').length;
      return `Successfully wrote ${lineCount} lines to "${args.path}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error writing file "${args.path}": ${msg}`;
    }
  }

  // ── run_terminal ───────────────────────────────────────────────────────────

  private async runTerminal(args: RunTerminalArgs): Promise<string> {
    if (this._askUserConfirmation) {
      const isAllowed = await this._askUserConfirmation(args.command);
      if (!isAllowed) {
        return 'Command denied by user.';
      }
    }

    const cwd = args.cwd
      ? this.resolveWorkspacePath(args.cwd)
      : (this._workspaceRoot ?? '.');

    return new Promise((resolve) => {
      // Use a disposable terminal that captures output
      const output: string[] = [];
      const { exec } = require('child_process') as typeof import('child_process');

      const timeout = 30_000; // 30s max
      const child = exec(args.command, { cwd, timeout }, (error, stdout, stderr) => {
        const lines: string[] = [];
        if (stdout.trim()) { lines.push(`STDOUT:\n${stdout.trim()}`); }
        if (stderr.trim()) { lines.push(`STDERR:\n${stderr.trim()}`); }
        if (error && !stdout && !stderr) { lines.push(`ERROR: ${error.message}`); }
        const result = lines.join('\n\n') || '(command produced no output)';
        resolve(`Command: ${args.command}\nCwd: ${cwd}\n\n${result}`);
      });

      child.on('error', (err) => {
        resolve(`Error running command "${args.command}": ${err.message}`);
      });
    });
  }

  // ── search_workspace ───────────────────────────────────────────────────────

  private static readonly SEARCH_EXCLUDED_DIRS = new Set([
    'node_modules',
    '.git',
    '.vscode',
    '.vscode-test',
    'out',
    'dist',
    'build',
    '.idea',
    '.next',
    '.cache',
    'coverage',
    '.coverage',
  ]);

  private static readonly BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svgz',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.woff', '.woff2', '.ttf', '.eot',
    '.mp3', '.mp4', '.mov', '.avi', '.wav',
    '.vsix', '.pyc', '.class',
  ]);

  private compileGlob(pattern?: string): (relPath: string, fileName: string) => boolean {
    if (!pattern) {
      return () => true;
    }
    const normalized = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized === '*' || normalized === '**' || normalized === '**/*') {
      return () => true;
    }

    try {
      let regexStr = '';
      let i = 0;
      while (i < normalized.length) {
        const c = normalized[i];
        if (c === '*' && normalized[i + 1] === '*') {
          if (normalized[i + 2] === '/') {
            regexStr += '(?:.*/)?';
            i += 3;
          } else {
            regexStr += '.*';
            i += 2;
          }
        } else if (c === '*') {
          regexStr += '[^/]*';
          i++;
        } else if (c === '?') {
          regexStr += '[^/]';
          i++;
        } else if (c === '{') {
          regexStr += '(?:';
          i++;
        } else if (c === '}') {
          regexStr += ')';
          i++;
        } else if (c === ',') {
          regexStr += '|';
          i++;
        } else if ('[].+^$()|\\'.includes(c)) {
          regexStr += '\\' + c;
          i++;
        } else {
          regexStr += c;
          i++;
        }
      }

      const regex = new RegExp(`^${regexStr}$`, 'i');
      if (!normalized.includes('/')) {
        return (relPath: string, fileName: string) => regex.test(fileName) || regex.test(relPath);
      }
      return (relPath: string) => regex.test(relPath);
    } catch {
      return () => true;
    }
  }

  private async searchWorkspace(args: SearchWorkspaceArgs): Promise<string> {
    const root = path.resolve(this._workspaceRoot ?? '.');
    const { query, include_pattern, is_regex } = args;

    if (!query) {
      return 'Error: Search query cannot be empty.';
    }

    let lineMatches: (line: string) => boolean;
    if (is_regex) {
      try {
        const rx = new RegExp(query);
        lineMatches = (line: string) => rx.test(line);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: Invalid regular expression "${query}": ${msg}`;
      }
    } else {
      lineMatches = (line: string) => line.includes(query);
    }

    const matchesPattern = this.compileGlob(include_pattern);
    const matches: string[] = [];
    const maxMatches = 50;
    const maxFileSize = 1024 * 1024; // 1 MB

    const walk = async (currentDir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (matches.length >= maxMatches) {
          return;
        }

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (entry.isSymbolicLink()) {
            continue;
          }
          const relDir = path.relative(root, fullPath).replace(/\\/g, '/');
          if (ToolExecutor.SEARCH_EXCLUDED_DIRS.has(entry.name)) {
            if (
              !include_pattern ||
              (!include_pattern.startsWith(entry.name) && !include_pattern.startsWith(relDir))
            ) {
              continue;
            }
          }
          await walk(fullPath);
        } else if (entry.isFile()) {
          const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

          if (!matchesPattern(relPath, entry.name)) {
            continue;
          }

          const ext = path.extname(entry.name).toLowerCase();
          if (ToolExecutor.BINARY_EXTENSIONS.has(ext)) {
            continue;
          }

          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size === 0 || stat.size > maxFileSize) {
              continue;
            }

            const buffer = await fs.promises.readFile(fullPath);
            const sampleLen = Math.min(buffer.length, 512);
            let isBinary = false;
            for (let i = 0; i < sampleLen; i++) {
              if (buffer[i] === 0) {
                isBinary = true;
                break;
              }
            }
            if (isBinary) {
              continue;
            }

            const content = buffer.toString('utf-8');
            const lines = content.split(/\r?\n/);

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              const line = lines[lineIdx];
              if (lineMatches(line)) {
                matches.push(`${relPath}:${lineIdx + 1}:${line}`);
                if (matches.length >= maxMatches) {
                  return;
                }
              }
            }
          } catch {
            continue;
          }
        }
      }
    };

    try {
      await walk(root);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error searching workspace: ${msg}`;
    }

    if (matches.length === 0) {
      return `No matches found for "${query}".`;
    }

    return `Found ${matches.length} match(es) for "${query}":\n\n${matches.join('\n')}`;
  }

  // ── list_directory ─────────────────────────────────────────────────────────

  private async listDirectory(args: ListDirectoryArgs): Promise<string> {
    const absPath = this.resolveWorkspacePath(args.path);
    const uri = vscode.Uri.file(absPath);

    try {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      if (entries.length === 0) {
        return `Directory "${args.path}" is empty.`;
      }

      const lines = entries
        .sort(([aName, aType], [bName, bType]) => {
          // Directories first
          if (aType !== bType) {
            return aType === vscode.FileType.Directory ? -1 : 1;
          }
          return aName.localeCompare(bName);
        })
        .map(([name, type]) => {
          const icon = type === vscode.FileType.Directory ? '📁' : '📄';
          return `${icon} ${name}`;
        });

      return `Contents of "${args.path}":\n\n${lines.join('\n')}`;
    } catch {
      return `Error: Could not read directory "${args.path}".`;
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private resolveWorkspacePath(relativePath: string): string {
    const root = path.resolve(this._workspaceRoot ?? '.');
    const resolved = path.resolve(root, relativePath);
    const rel = path.relative(root, resolved);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`Access denied: path "${relativePath}" is outside the workspace.`);
    }
    return resolved;
  }

  dispose() {
    this._terminal?.dispose();
  }
}
