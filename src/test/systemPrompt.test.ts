import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { AGENT_TOOLS } from '../tools';

// Access the private getSystemPrompt via a helper that reconstructs the fallback logic
// (since SidebarProvider.getSystemPrompt is private and tightly coupled to vscode extension URI)

suite('System Prompt - Tool Injection Test Suite', () => {

  suite('Fallback prompt generation', () => {
    // Reproduce the fallback logic used in SidebarProvider.getSystemPrompt()
    function generateFallbackPrompt(): string {
      const toolList = AGENT_TOOLS
        .map(t => `- ${t.function.name}: ${t.function.description}`)
        .join('\n');
      return `You have access to the following tools:\n\n${toolList}`;
    }

    test('should contain every tool name from AGENT_TOOLS', () => {
      const prompt = generateFallbackPrompt();
      for (const tool of AGENT_TOOLS) {
        assert.ok(
          prompt.includes(tool.function.name),
          `Prompt is missing tool name: "${tool.function.name}"`
        );
      }
    });

    test('should contain every tool description from AGENT_TOOLS', () => {
      const prompt = generateFallbackPrompt();
      for (const tool of AGENT_TOOLS) {
        assert.ok(
          prompt.includes(tool.function.description),
          `Prompt is missing description for tool: "${tool.function.name}"`
        );
      }
    });

    test('should have exactly one line per tool', () => {
      const prompt = generateFallbackPrompt();
      const toolLines = prompt.split('\n').filter(line => line.startsWith('- '));
      assert.strictEqual(
        toolLines.length,
        AGENT_TOOLS.length,
        `Expected ${AGENT_TOOLS.length} tool lines, got ${toolLines.length}`
      );
    });

    test('should start with the expected header', () => {
      const prompt = generateFallbackPrompt();
      assert.ok(
        prompt.startsWith('You have access to the following tools:'),
        'Fallback prompt should start with the tools header'
      );
    });

    test('each tool line should follow the format "- name: description"', () => {
      const prompt = generateFallbackPrompt();
      const toolLines = prompt.split('\n').filter(line => line.startsWith('- '));

      for (const tool of AGENT_TOOLS) {
        const expectedPrefix = `- ${tool.function.name}: `;
        const matchingLine = toolLines.find(line => line.startsWith(expectedPrefix));
        assert.ok(
          matchingLine,
          `No line found with expected prefix "${expectedPrefix}"`
        );
      }
    });
  });

  suite('AGENT_TOOLS integrity', () => {
    test('should have at least one tool defined', () => {
      assert.ok(AGENT_TOOLS.length > 0, 'AGENT_TOOLS should not be empty');
    });

    test('every tool should have a non-empty name', () => {
      for (const tool of AGENT_TOOLS) {
        assert.ok(
          tool.function.name && tool.function.name.trim().length > 0,
          `Tool has empty name`
        );
      }
    });

    test('every tool should have a non-empty description', () => {
      for (const tool of AGENT_TOOLS) {
        assert.ok(
          tool.function.description && tool.function.description.trim().length > 0,
          `Tool "${tool.function.name}" has empty description`
        );
      }
    });

    test('every tool should have type "function"', () => {
      for (const tool of AGENT_TOOLS) {
        assert.strictEqual(
          tool.type,
          'function',
          `Tool "${tool.function.name}" has type "${tool.type}" instead of "function"`
        );
      }
    });

    test('tool names should be unique', () => {
      const names = AGENT_TOOLS.map(t => t.function.name);
      const uniqueNames = new Set(names);
      assert.strictEqual(
        uniqueNames.size,
        names.length,
        `Duplicate tool names found: ${names.filter((n, i) => names.indexOf(n) !== i)}`
      );
    });
  });
});
