interface WatcherEntry {
  kind: string;
  ready: Promise<string>;
  remove: (id: string) => Promise<void>;
  stopping?: Promise<void>;
}

// Keep native handles until the platform confirms removal, including pending starts.
export class LocationWatcherRegistry {
  private entries = new Set<WatcherEntry>();
  onFailure: () => void = () => {};

  add(kind: string, create: () => Promise<string>, remove: (id: string) => Promise<void>): Promise<string> {
    const entry = { kind, ready: Promise.resolve().then(create), remove };
    this.entries.add(entry);
    void entry.ready.catch(() => this.entries.delete(entry));
    return entry.ready;
  }

  async remove(kind: string, id: string): Promise<void> {
    await Promise.all([...this.entries].filter(e => e.kind === kind).map(async entry => {
      let handle: string;
      try { handle = await entry.ready; } catch { return; }
      if (handle === id) await this.stop(entry);
    }));
  }

  async stopAll(): Promise<void> {
    while (this.entries.size) await Promise.all([...this.entries].map(entry => this.stop(entry)));
  }

  async retry(operation: () => void | Promise<void>): Promise<void> {
    let failures = 0;
    for (;;) {
      try { await operation(); return; }
      catch {
        if (++failures === 3) {
          // A notification failure must never stop native cleanup retries.
          try { this.onFailure(); } catch { /* keep retrying */ }
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(failures * 500, 5000)));
      }
    }
  }

  private stop(entry: WatcherEntry): Promise<void> {
    if (!entry.stopping) entry.stopping = (async () => {
      let id: string;
      try { id = await entry.ready; } catch { return; }
      await this.retry(() => entry.remove(id));
    })().then(() => { this.entries.delete(entry); });
    return entry.stopping;
  }
}

export const locationWatchers = new LocationWatcherRegistry();
