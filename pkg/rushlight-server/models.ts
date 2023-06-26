import { ErrorReply, createClient, defineScript } from "@redis/client";

// Run multiple XADD operations on a document, exiting if any one fails.
const addUpdates = defineScript({
  NUMBER_OF_KEYS: 1,
  SCRIPT: `
    local version = ARGV[1]
    for i = 2, #ARGV do
      redis.call("XADD", KEYS[1], (version + i - 1) .. "-0", "d", ARGV[i])
    end
  `,
  transformArguments: () => [], // not needed
});

// Trim entries from a stream and delete it if it's empty.
const trimMayDelete = defineScript({
  NUMBER_OF_KEYS: 1,
  SCRIPT: `
    local version = ARGV[1]
    redis.call("XTRIM", KEYS[1], "MINID", "~", (version + 1) .. "-0", "LIMIT", "0")
    if redis.call("XLEN", KEYS[1]) == 0 then
      redis.call("DEL", KEYS[1])
      return true
    end
  `,
  transformArguments: () => [], // not needed
});

export class Streams {
  constructor(
    private redis: ReturnType<typeof createClient>,
    private prefix: string
  ) {}

  /** Read document updates newer than a version, optionally blocking if there are none. */
  async read(id: string, version: number, blocking?: number) {
    const entries = await this.redis.executeIsolated((redis) =>
      redis.xRead(
        { key: `${this.prefix}:${id}`, id: `${version}-0` },
        { BLOCK: blocking, COUNT: 1024 }
      )
    );
    const updates = entries?.[0]?.messages ?? [];
    return updates.map((u) => ({
      version: parseInt(u.id.slice(0, -2)),
      update: JSON.parse(u.message.d),
    }));
  }

  /** Add document updates at a version, returning whether it was successful. */
  async add(id: string, version: number, updates: any[]) {
    try {
      await this.redis.executeScript(addUpdates, [
        `${this.prefix}:${id}`,
        version.toString(),
        ...updates.map((u) => JSON.stringify(u)),
      ]);
      return true;
    } catch (err) {
      if (err instanceof ErrorReply) {
        // Someone else raced to push updates before us, so the ID is invalid.
        if (err.message.startsWith("ERR ")) {
          return false;
        }
      }
      throw err;
    }
  }

  /** Remove document updates older than a version. */
  async trim(id: string, version: number) {
    const resp = await this.redis.executeScript(trimMayDelete, [
      `${this.prefix}:${id}`,
      version.toString(),
    ]);
    return Boolean(resp);
  }
}

export class Dirty {
  constructor(
    private redis: ReturnType<typeof createClient>,
    private prefix: string
  ) {}

  /** Mark a document for compaction at a given timestamp. */
  async enqueue(id: string, time: number, notExists?: boolean) {
    await this.redis.zAdd(
      `${this.prefix}-dirty`,
      { score: time, value: id },
      notExists ? { NX: true } : undefined
    );
  }

  /** Return the next document that is marked for compaction. */
  async dequeue() {
    const resp = await this.redis.zPopMin(`${this.prefix}-dirty`);
    return resp ? { id: resp.value, time: resp.score } : null;
  }
}
