import * as vscode from 'vscode';
import * as path from 'path';
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
        'Update an existing file by replacing a specific block of code based on line numbers. The lines from start_line to end_line (inclusive) will be replaced by the provided content.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to the file relative to the workspace root. Example: "src/extension.ts"',
          },
          start_line: {
            type: 'number',
            description: 'The 1-indexed line to start the replacement (inclusive).',
          },
          end_line: {
            type: 'number',
            description: 'The 1-indexed line to end the replacement (inclusive).',
          },
          content: {
            type: 'string',
            description: 'The replacement content.',
          },
        },
        required: ['path', 'start_line', 'end_line', 'content'],
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

  constructor(private readonly _workspaceRoot: string | undefined) {}

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
        .map((line, i) => `${start + i + 1}: ${line}`)
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
      const replacementLines = args.content.split(/\r?\n/);

      const start = Math.max(1, args.start_line);
      const end = Math.min(lines.length, Math.max(start, args.end_line));

      // Lines are 1-indexed, so the array index is start - 1
      // We remove (end - start + 1) lines and insert the new content
      lines.splice(start - 1, end - start + 1, ...replacementLines);
      
      const newContent = lines.join(isCrlf ? '\r\n' : '\n');
      const newBytes = Buffer.from(newContent, 'utf-8');
      await vscode.workspace.fs.writeFile(uri, newBytes);

      // Open in editor so user sees what was written
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

      return `Successfully replaced lines ${start} to ${end} in "${args.path}".`;
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

  private async searchWorkspace(args: SearchWorkspaceArgs): Promise<string> {
    const root = this._workspaceRoot ?? '.';
    const { query, include_pattern, is_regex } = args;

    return new Promise((resolve) => {
      const { exec } = require('child_process') as typeof import('child_process');

      // Build rg command: max 50 matches, line numbers
      const escapedQuery = query.replace(/"/g, '\\"');
      const regexFlag = is_regex ? '' : '--fixed-strings';
      const globFlag = include_pattern ? `--glob "${include_pattern}"` : '';
      const cmd = `rg --line-number --max-count 1 --max-filesize 1M ${regexFlag} ${globFlag} "${escapedQuery}" .`;

      exec(cmd, { cwd: root, timeout: 10_000 }, (error, stdout, stderr) => {
        if (error && !stdout) {
          // rg exits with code 1 when no matches, not an error
          if (error.code === 1) {
            resolve(`No matches found for "${query}".`);
          } else {
            // Fallback to grep if rg not available
            const grepCmd = `grep -rn --include="${include_pattern ?? '*'}" ${is_regex ? '-E' : '-F'} "${escapedQuery}" .`;
            exec(grepCmd, { cwd: root, timeout: 10_000 }, (_e2, gStdout) => {
              if (!gStdout.trim()) {
                resolve(`No matches found for "${query}".`);
              } else {
                const lines = gStdout.trim().split('\n').slice(0, 50);
                resolve(`Found ${lines.length} match(es) for "${query}":\n\n${lines.join('\n')}`);
              }
            });
          }
          return;
        }

        const lines = (stdout ?? '').trim().split('\n').filter(Boolean).slice(0, 50);
        if (lines.length === 0) {
          resolve(`No matches found for "${query}".`);
        } else {
          resolve(`Found ${lines.length} match(es) for "${query}":\n\n${lines.join('\n')}`);
        }
      });
    });
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
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    const root = this._workspaceRoot ?? '.';
    return path.join(root, relativePath);
  }

  dispose() {
    this._terminal?.dispose();
  }
}
