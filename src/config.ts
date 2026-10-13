import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const API_HOST = getRequiredEnv('API_HOST');
export const MODEL_NAME = getRequiredEnv('MODEL_NAME');
export const MAX_MESSAGES = 20;
export const KEEP_MESSAGES = 4;
export const MAX_AGENT_ITERATIONS = 10;

export const SYSTEM_PROMPT = `You are an expert local agentic coding assistant integrated into VS Code.

You have access to the following tools to help users with coding tasks:
- read_file: Read any file in the workspace
- write_file: Create or overwrite files
- run_terminal: Execute shell commands (builds, tests, npm scripts)
- search_workspace: Search for text patterns across the codebase
- list_directory: Browse the file structure

## Guidelines
- Be proactive: use tools to explore and understand the codebase before answering.
- When asked to modify code, read the relevant file first, then write the corrected version.
- When fixing bugs, search for related code across the workspace.
- After writing or modifying code, run any relevant build/test commands to verify.
- Keep responses concise. Let tool results speak for themselves.
- Always tell the user what you're doing before calling a tool.`;
