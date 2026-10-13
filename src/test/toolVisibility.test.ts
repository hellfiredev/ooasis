import * as assert from 'assert';
import { shouldShowToolOutput } from '../history/toolVisibility';

suite('toolVisibility Test Suite', () => {
  test('run_terminal output is visible', () => {
    assert.strictEqual(shouldShowToolOutput('run_terminal'), true);
  });

  test('all other tools have hidden output', () => {
    for (const name of ['read_file', 'write_file', 'replace_in_file', 'search_workspace', 'list_directory', 'unknown_tool']) {
      assert.strictEqual(shouldShowToolOutput(name), false, name);
    }
  });
});
