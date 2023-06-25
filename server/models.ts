import { ErrorReply, defineScript } from "@redis/client";

import { redis, sql } from "./db.ts";

const initialText = `# CodeMirror Collaboration

This is a collaborative **Markdown** editor shared by all viewers of this page. You just opened a new document, with your own personal link!

Type here, and the output is rendered below. You can see other people's cursors.

Source code is available [here](https://github.com/ekzhang/cm-collab).`;

/** Run multiple XADD operations on a document, exiting if any one fails. */
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

/** Trim entries from a stream and delete it if it's empty. */
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

export const streams = {
  /** Read document updates newer than a version, optionally blocking if there are none. */
  async read(id: string, version: number, blocking?: number) {
    const entries = await redis.executeIsolated((redis) =>
      redis.xRead(
        { key: `doc:${id}`, id: `${version}-0` },
        { BLOCK: blocking, COUNT: 1024 }
      )
    );
    const updates = entries?.[0]?.messages ?? [];
    return updates.map((u) => ({
      version: parseInt(u.id.slice(0, -2)),
      update: JSON.parse(u.message.d),
    }));
  },

  /** Add document updates at a version, returning whether it was successful. */
  async add(id: string, version: number, updates: any[]) {
    try {
      await redis.executeScript(addUpdates, [
        `doc:${id}`,
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
  },

  /** Remove document updates older than a version. */
  async trim(id: string, version: number) {
    const resp = await redis.executeScript(trimMayDelete, [
      `doc:${id}`,
      version.toString(),
    ]);
    return Boolean(resp);
  },
};

export const checkpoints = {
  /** Load a saved document checkpoint. */
  async load(id: string) {
    let version = 0;
    let doc = initialText;
    const results =
      await sql`SELECT content, version FROM documents WHERE id = ${id}`;
    if (results.length) {
      version = results[0].version;
      doc = results[0].content;
    }
    return { version, doc };
  },

  /** Save a document checkpoint. */
  async save(id: string, doc: string, version: number) {
    await sql`
      INSERT INTO
        documents AS d (id, content, version)
      VALUES
        (${id}, ${doc}, ${version})
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        version = EXCLUDED.version
      WHERE
        d.version < ${version}
    `;
  },
};

export const dirty = {
  /** Mark a document for compaction at a given timestamp. */
  async enqueue(id: string, time: number, notExists?: boolean) {
    await redis.zAdd(
      "doc-dirty",
      { score: time, value: id },
      notExists ? { NX: true } : undefined
    );
  },

  /** Return the next document that is marked for compaction. */
  async dequeue() {
    const resp = await redis.zPopMin("doc-dirty");
    return resp ? { id: resp.value, time: resp.score } : null;
  },
};
