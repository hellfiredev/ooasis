import * as vscode from 'vscode';
import { SessionFile, SessionMeta } from '../types/chat';

const INDEX_FILE = 'index.json';
const ID_PATTERN = /^[\w-]+$/;
const TITLE_MAX_LENGTH = 60;

export function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeSessionTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) { return 'Untitled conversation'; }
  return oneLine.length > TITLE_MAX_LENGTH
    ? oneLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd() + '…'
    : oneLine;
}

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function toMeta(s: SessionMeta): SessionMeta {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messageCount,
    ...(s.model && { model: s.model }),
  };
}

function sortByUpdatedDesc(list: SessionMeta[]): SessionMeta[] {
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Persists chat sessions as JSON files:
 *
 *   <baseUri>/sessions/index.json   — SessionMeta[] (rebuildable)
 *   <baseUri>/sessions/<id>.json    — SessionFile
 *
 * All mutating operations are serialized through an internal queue so the
 * index file is never written concurrently.
 */
export class SessionStore {
  private readonly _dir: vscode.Uri;
  private _queue: Promise<unknown> = Promise.resolve();

  constructor(
    baseUri: vscode.Uri,
    private readonly _getMaxSessions: () => number = () => 0,
  ) {
    this._dir = vscode.Uri.joinPath(baseUri, 'sessions');
  }

  get directory(): vscode.Uri {
    return this._dir;
  }

  list(): Promise<SessionMeta[]> {
    return this._enqueue(() => this._readIndex());
  }

  load(id: string): Promise<SessionFile | undefined> {
    this._assertValidId(id);
    return this._enqueue(() => this._readSession(id));
  }

  save(session: SessionFile): Promise<void> {
    this._assertValidId(session.id);
    return this._enqueue(async () => {
      await vscode.workspace.fs.createDirectory(this._dir);
      await this._writeAtomic(this._sessionUri(session.id), session);

      let index = (await this._readIndex()).filter((m) => m.id !== session.id);
      index.push(toMeta(session));
      index = sortByUpdatedDesc(index);
      index = await this._prune(index);
      await this._writeAtomic(this._indexUri(), index);
    });
  }

  delete(id: string): Promise<void> {
    this._assertValidId(id);
    return this._enqueue(async () => {
      await this._deleteQuietly(this._sessionUri(id));
      const index = (await this._readIndex()).filter((m) => m.id !== id);
      if (await this._exists(this._dir)) {
        await this._writeAtomic(this._indexUri(), index);
      }
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private _enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => undefined);
    return run;
  }

  private _assertValidId(id: unknown): void {
    if (!isValidSessionId(id)) {
      throw new Error(`Invalid session id: ${String(id)}`);
    }
  }

  private _sessionUri(id: string): vscode.Uri {
    return vscode.Uri.joinPath(this._dir, `${id}.json`);
  }

  private _indexUri(): vscode.Uri {
    return vscode.Uri.joinPath(this._dir, INDEX_FILE);
  }

  private async _exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async _readJson<T>(uri: vscode.Uri): Promise<T | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(bytes).toString('utf-8')) as T;
    } catch {
      return undefined;
    }
  }

  private async _writeAtomic(uri: vscode.Uri, data: unknown): Promise<void> {
    const tmp = uri.with({ path: uri.path + '.tmp' });
    await vscode.workspace.fs.writeFile(tmp, Buffer.from(JSON.stringify(data), 'utf-8'));
    await vscode.workspace.fs.rename(tmp, uri, { overwrite: true });
  }

  private async _deleteQuietly(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // Already gone
    }
  }

  private async _readSession(id: string): Promise<SessionFile | undefined> {
    const data = await this._readJson<SessionFile>(this._sessionUri(id));
    if (!data || data.id !== id || !Array.isArray(data.apiHistory) || !Array.isArray(data.displayLog)) {
      return undefined;
    }
    return data;
  }

  private async _readIndex(): Promise<SessionMeta[]> {
    const index = await this._readJson<SessionMeta[]>(this._indexUri());
    if (Array.isArray(index) && index.every((m) => m && isValidSessionId(m.id))) {
      return sortByUpdatedDesc(index);
    }
    return this._rebuildIndex();
  }

  /** Reconstruct the index from session files (index missing or corrupt). */
  private async _rebuildIndex(): Promise<SessionMeta[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this._dir);
    } catch {
      return [];
    }

    const metas: SessionMeta[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json') || name === INDEX_FILE) {
        continue;
      }
      const id = name.slice(0, -'.json'.length);
      if (!isValidSessionId(id)) { continue; }
      const session = await this._readSession(id);
      if (session) { metas.push(toMeta(session)); }
    }

    const sorted = sortByUpdatedDesc(metas);
    try {
      await this._writeAtomic(this._indexUri(), sorted);
    } catch {
      // Non-fatal: index will be rebuilt again next time
    }
    return sorted;
  }

  private async _prune(index: SessionMeta[]): Promise<SessionMeta[]> {
    const max = this._getMaxSessions();
    if (!(max > 0) || index.length <= max) {
      return index;
    }
    const removed = index.slice(max);
    for (const meta of removed) {
      await this._deleteQuietly(this._sessionUri(meta.id));
    }
    return index.slice(0, max);
  }
}
