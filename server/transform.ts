import { ChangeSet, Text } from "@codemirror/state";
import { ErrorReply, defineScript } from "@redis/client";

import { redis, sql } from "./db.ts";

/**
 * How often to compact the document history, in milliseconds.
 *
 * This is the interval at which streams are checkpointed, regardless of how
 * many server replicas are running. Each modified document is queued for
 * compaction. On each interval, the database is updated to reflect new changes,
 * while the updates older than the previous version are removed from the
 * document's Redis stream.
 *
 * The tradeoff here is between memory usage and performance. A smaller interval
 * will result in more frequent compaction, lowering Redis's memory usage, but
 * requiring more frequent database updates and potentially desynchronizing with
 * slower clients. A larger interval will mean updates are stored for longer,
 * putting more memory pressure on Redis.
 *
 * The current value has been set empirically as a balance between these
 * tradeoffs, between Postgres and Redis. Shorter intervals also work.
 */
const compactionInterval = 1000 * 30; // 30 seconds

const initialText = `# CodeMirror Collaboration

This is a collaborative **Markdown** editor shared by all viewers of this page. You just opened a new document, with your own personal link!

Type here to see the output rendered below.

Source code is available [here](https://github.com/ekzhang/cm-collab).`;

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

async function pullUpdates(id: string, version: number) {
  console.log(` - pullUpdates(${id}, ${version})`);
  const entries = await redis.executeIsolated((redis) =>
    redis.xRead(
      { key: `doc:${id}`, id: `${version}-0` },
      { BLOCK: 5000, COUNT: 1024 }
    )
  );
  const updates = entries?.[0]?.messages ?? [];
  if (updates.length && updates[0].id !== `${version + 1}-0`) {
    return { status: "desync" };
  }
  return {
    status: "ok",
    updates: updates.map((u) => JSON.parse(u.message.d)),
  };
}

async function pushUpdates(id: string, version: number, updates: any[]) {
  console.log(` - pushUpdates(${id}, ${version}, [len: ${updates.length}])`);
  try {
    await redis.executeScript(addUpdates, [
      `doc:${id}`,
      version.toString(),
      ...updates.map((u) => JSON.stringify(u)),
    ]);
  } catch (err) {
    if (err instanceof ErrorReply) {
      // Someone else raced to push updates before us, so the ID is invalid.
      if (err.message.startsWith("ERR ")) {
        return false;
      }
    }
    throw err;
  }
  await redis.zAdd(
    "doc-dirty",
    { score: Date.now() + compactionInterval, value: id },
    { NX: true }
  );
  return true;
}

async function getDocumentInternal(id: string): Promise<{
  dbVersion: number;
  version: number;
  doc: string;
}> {
  let version = 0;
  let doc = Text.of(initialText.split("\n"));

  const results =
    await sql`SELECT content, version FROM documents WHERE id = ${id}`;
  if (results.length) {
    version = results[0].version;
    doc = Text.of(results[0].content.split("\n"));
  }

  const entries = await redis.xRead({ key: `doc:${id}`, id: `${version}-0` });
  const updates = entries?.[0]?.messages ?? [];
  if (updates.length && updates[0].id !== `${version + 1}-0`) {
    throw new Error("Invariant violated, document is desynchronized");
  }
  for (const u of updates) {
    const changes = ChangeSet.fromJSON(JSON.parse(u.message.d).changes);
    doc = changes.apply(doc);
  }

  return {
    dbVersion: version,
    version: version + updates.length,
    doc: doc.toString(),
  };
}

async function getDocument(id: string) {
  console.log(` - getDocuments(${id})`);
  const { version, doc } = await getDocumentInternal(id);
  return { version, doc };
}

export function handleMessage(id: string, data: any) {
  if (data.type == "pullUpdates") {
    return pullUpdates(id, data.version);
  } else if (data.type == "pushUpdates") {
    return pushUpdates(id, data.version, data.updates);
  } else if (data.type == "getDocument") {
    return getDocument(id);
  } else {
    throw new Error("Invalid message type");
  }
}

// Periodically checkpoints old documents by reading the dirty list.
export async function compactionTask() {
  while (true) {
    try {
      await runCompaction();
    } catch (err: any) {
      console.error("Error during compaction:", err.toString());
    }
    // No new documents to clean up, wait for a little bit.
    await new Promise((resolve) =>
      setTimeout(resolve, 0.1 * compactionInterval)
    );
  }
}

async function runCompaction() {
  while (true) {
    const resp = await redis.zPopMin("doc-dirty");
    if (resp === null) {
      break;
    }
    const { score, value: id } = resp;
    if (Date.now() < score) {
      await redis.zAdd("doc-dirty", { score, value: id });
      break;
    }
    console.log(`Compacting doc:${id}`);
    try {
      const { dbVersion, version, doc } = await getDocumentInternal(id);
      if (dbVersion < version) {
        // Create a checkpoint.
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
      }
      const deleted = await redis.executeScript(trimMayDelete, [
        `doc:${id}`,
        dbVersion.toString(),
      ]);
      if (!deleted) {
        await redis.zAdd("doc-dirty", {
          score: Date.now() + compactionInterval,
          value: id,
        });
      }
    } catch (err: any) {
      await redis.zAdd("doc-dirty", { score, value: id });
      throw err;
    }
  }
}
