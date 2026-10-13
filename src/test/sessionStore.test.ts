import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionStore } from '../history/sessionStore';
import { SessionFile } from '../types/chat';

import * as os from 'os';
import * as path from 'path';

suite('SessionStore Test Suite', () => {
  let store: SessionStore;
  let testStorageUri: vscode.Uri;

  setup(async () => {
    const tmpDir = os.tmpdir();
    testStorageUri = vscode.Uri.file(path.join(tmpDir, `ooasis-sessions-test-${Date.now()}`));
    
    try {
      await vscode.workspace.fs.delete(testStorageUri, { recursive: true, useTrash: false });
    } catch (e) {
      // Ignore
    }
    
    // Pass getMaxSessions = () => 2 for testing pruning
    store = new SessionStore(testStorageUri, () => 2);
  });

  teardown(async () => {
    try {
      await vscode.workspace.fs.delete(testStorageUri, { recursive: true, useTrash: false });
    } catch (e) {
      // Ignore
    }
  });

  test('should save and load a session', async () => {
    const session: SessionFile = {
      id: 'test-id-1',
      title: 'Test Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 1,
      version: 1,
      totalUsedTokens: 0,
      apiHistory: [],
      displayLog: []
    };

    await store.save(session);
    
    const loaded = await store.load('test-id-1');
    assert.ok(loaded);
    assert.strictEqual(loaded.id, 'test-id-1');
    assert.strictEqual(loaded.title, 'Test Session');
  });

  test('should list sessions in index', async () => {
    const session1: SessionFile = {
      id: 's1', title: 'Session 1', createdAt: 1, updatedAt: 1, messageCount: 1, version: 1, totalUsedTokens: 0,
      apiHistory: [], displayLog: []
    };
    const session2: SessionFile = {
      id: 's2', title: 'Session 2', createdAt: 2, updatedAt: 2, messageCount: 1, version: 1, totalUsedTokens: 0,
      apiHistory: [], displayLog: []
    };

    await store.save(session1);
    await store.save(session2);

    const index = await store.list();
    assert.strictEqual(index.length, 2);
    assert.strictEqual(index[0].id, 's2');
    assert.strictEqual(index[1].id, 's1');
  });

  test('should delete a session', async () => {
    const session: SessionFile = {
      id: 'del-id', title: 'Del', createdAt: 1, updatedAt: 1, messageCount: 1, version: 1, totalUsedTokens: 0,
      apiHistory: [], displayLog: []
    };

    await store.save(session);
    await store.delete('del-id');

    const index = await store.list();
    assert.strictEqual(index.length, 0);

    const loaded = await store.load('del-id');
    assert.strictEqual(loaded, undefined);
  });

  test('should prune old sessions based on config', async () => {
    for (let i = 1; i <= 3; i++) {
      await store.save({
        id: `s${i}`, title: `Session ${i}`, createdAt: i, updatedAt: i, messageCount: 1, version: 1, totalUsedTokens: 0,
        apiHistory: [], displayLog: []
      });
    }

    const index = await store.list();
    // store was created with getMaxSessions() => 2
    assert.strictEqual(index.length, 2);
    
    assert.ok(index.find(m => m.id === 's3'));
    assert.ok(index.find(m => m.id === 's2'));
    assert.ok(!index.find(m => m.id === 's1'));
  });
});
