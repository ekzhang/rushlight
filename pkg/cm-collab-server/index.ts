import { ChangeSet, Text } from "@codemirror/state";
import { createClient } from "@redis/client";

import { Dirty, Streams } from "./models";

export type Checkpoint = {
  version: number;
  doc: string;
};

export type Message =
  | {
      type: "pullUpdates";
      version: number;
    }
  | {
      type: "pushUpdates";
      version: number;
      updates: any[];
    }
  | {
      type: "getDocument";
    };

export type ServerOptions = {
  /** Connection string for Redis, used to share document changes. */
  readonly redisUrl: string;

  /** Load the most recent document checkpoint from a persistent database. */
  readonly loadCheckpoint: (id: string) => Promise<Checkpoint>;

  /** Save a document checkpoint to a persistent database. */
  readonly saveCheckpoint: (
    id: string,
    checkpoint: Checkpoint
  ) => Promise<void>;

  /**
   * How often to compact the document history, in milliseconds.
   *
   * This is the interval at which streams are checkpointed, regardless of how
   * many server replicas are running. Each modified document is queued for
   * compaction. On each interval, the database is updated to reflect new
   * changes, while the updates older than the previous version are removed from
   * the document's Redis stream.
   *
   * The tradeoff here is between memory usage and performance. A smaller
   * interval will result in more frequent compaction, lowering Redis's memory
   * usage, but requiring more frequent database updates and potentially
   * desynchronizing with slower clients. A larger interval will mean updates
   * are stored for longer, putting more memory pressure on Redis.
   *
   * The default value balances these considerations.
   */
  readonly compactionInterval?: number;

  /** How long to block on a stream when long polling for updates. */
  readonly blockingMs?: number;

  /** The maximum number of Redis connections for long polling. */
  readonly blockingPoolSize?: number;
};

const defualtOptions = {
  compactionInterval: 1000 * 30, // 30 seconds
  blockingMs: 1000 * 5, // 5 seconds
  blockingPoolSize: 2048,
};

export class CollabServer {
  private constructor(
    readonly options: ServerOptions & typeof defualtOptions,
    private readonly streams: Streams,
    private readonly dirty: Dirty
  ) {}

  /** Construct a new server. This will connect to Redis. */
  static async of(options: ServerOptions) {
    const opts = { ...defualtOptions, ...options };
    const redis = createClient({
      url: opts.redisUrl,
      isolationPoolOptions: {
        max: opts.blockingPoolSize ?? 2048,
      },
    });
    redis.on("error", console.error);
    await redis.connect();
    return new CollabServer(opts, new Streams(redis), new Dirty(redis));
  }

  /** Handle an incoming collaboration message. */
  handle(id: string, message: Message): Promise<any> {
    if (message.type == "pullUpdates") {
      return this.pullUpdates(id, message.version);
    } else if (message.type == "pushUpdates") {
      return this.pushUpdates(id, message.version, message.updates);
    } else if (message.type == "getDocument") {
      return this.getDocument(id);
    } else {
      throw new Error("Invalid message type");
    }
  }

  /** Read the latest version of a document from the server. */
  async getDocument(id: string): Promise<Checkpoint> {
    const { version, doc } = await this.getDocumentInternal(id);
    return { version, doc };
  }

  /** Periodically checkpoint old documents by reading the dirty list. */
  async compactionTask() {
    while (true) {
      try {
        await this.runCompaction();
      } catch (err: any) {
        console.error("Error during compaction:", err.toString());
      }
      // No new documents to clean up, wait for a little bit.
      await new Promise((resolve) =>
        setTimeout(resolve, 0.1 * this.options.compactionInterval)
      );
    }
  }

  private async getDocumentInternal(
    id: string
  ): Promise<Checkpoint & { dbVersion: number }> {
    let { version, doc: docS } = await this.options.loadCheckpoint(id);
    let doc = Text.of(docS.split("\n"));

    const updates = await this.streams.read(id, version);
    if (updates.length && updates[0].version !== version + 1) {
      throw new Error("Invariant violated, document is desynchronized");
    }
    for (const u of updates) {
      try {
        doc = ChangeSet.fromJSON(u.update.changes).apply(doc);
      } catch (err: any) {
        console.error("Error applying update:", err.toString());
      }
    }

    return {
      dbVersion: version,
      version: version + updates.length,
      doc: doc.toString(),
    };
  }

  private async pullUpdates(id: string, version: number) {
    const updates = await this.streams.read(id, version, 5000);
    if (updates.length && updates[0].version !== version + 1) {
      return { status: "desync" };
    }
    return { status: "ok", updates: updates.map((u) => u.update) };
  }

  private async pushUpdates(id: string, version: number, updates: any[]) {
    if (!(await this.streams.add(id, version, updates))) {
      return false;
    }
    const time = Date.now() + this.options.compactionInterval;
    await this.dirty.enqueue(id, time, true);
    return true;
  }

  private async runCompaction() {
    while (true) {
      const resp = await this.dirty.dequeue();
      if (resp === null) break;
      const { id, time } = resp;
      if (Date.now() < time) {
        await this.dirty.enqueue(id, time);
        break;
      }
      try {
        const { dbVersion, version, doc } = await this.getDocumentInternal(id);
        if (dbVersion < version) {
          await this.options.saveCheckpoint(id, { version, doc });
        }
        if (!(await this.streams.trim(id, dbVersion))) {
          const time = Date.now() + this.options.compactionInterval;
          await this.dirty.enqueue(id, time);
        }
      } catch (err: any) {
        await this.dirty.enqueue(id, time);
        throw err;
      }
    }
  }
}
