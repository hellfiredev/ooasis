import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('VS Code API is available', () => {
		assert.ok(vscode.workspace);
		assert.ok(vscode.commands);
	});
});
