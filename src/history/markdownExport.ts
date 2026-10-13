import { DisplayEntry, SessionFile } from '../types/chat';

export const TOOL_RESULT_MAX_CHARS = 2000;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Wrap content in a code fence that is longer than any backtick run inside it. */
function fence(content: string, lang = ''): string {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((r) => r.length));
  const ticks = '`'.repeat(Math.max(3, longestRun + 1));
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

function quote(text: string): string {
  return text.split('\n').map((l) => `> ${l}`).join('\n');
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) { return text; }
  return `${text.slice(0, max)}\n… (truncated, ${text.length - max} more characters)`;
}

function entryToMarkdown(entry: DisplayEntry): string {
  switch (entry.type) {
    case 'user': {
      let out = `### 🧑 User\n\n${entry.text}`;
      if (entry.attachments?.length) {
        out += `\n\n_Attachments: ${entry.attachments.map((a) => `\`${a}\``).join(', ')}_`;
      }
      return out;
    }

    case 'assistant': {
      const parts: string[] = ['### 🤖 Assistant'];
      if (entry.reasoning) {
        const time = entry.reasoningTimeMs ? ` (${(entry.reasoningTimeMs / 1000).toFixed(1)}s)` : '';
        parts.push(`<details><summary>Reasoning${time}</summary>\n\n${entry.reasoning}\n\n</details>`);
      }
      if (entry.text) {
        parts.push(entry.text);
      }
      for (const tc of entry.toolCalls ?? []) {
        let block = `<details><summary>🔧 ${tc.name}</summary>\n\n${fence(prettyArgs(tc.args), 'json')}`;
        if (tc.result !== undefined) {
          block += `\n\n${fence(truncate(tc.result, TOOL_RESULT_MAX_CHARS), 'text')}`;
        }
        block += '\n\n</details>';
        parts.push(block);
      }
      return parts.join('\n\n');
    }

    case 'error':
      return quote(`⚠️ **Error:** ${entry.text}`);

    case 'summary':
      return quote(`📝 **Context compressed:**\n\n${entry.text}`);
  }
}

export function sessionToMarkdown(session: SessionFile): string {
  const headerBits = [
    session.model ? `Model: ${session.model}` : undefined,
    `Created ${formatDateTime(session.createdAt)}`,
    `Updated ${formatDateTime(session.updatedAt)}`,
    `${session.messageCount} turn${session.messageCount === 1 ? '' : 's'}`,
  ].filter(Boolean);

  const sections = [
    `# ${session.title}`,
    `_${headerBits.join(' · ')}_`,
    ...session.displayLog.map((e) => `---\n\n${entryToMarkdown(e)}`),
  ];

  return sections.join('\n\n') + '\n';
}
