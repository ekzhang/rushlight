import { ChangeSet, Text } from "@codemirror/state";

import { checkpoints, dirty, streams } from "./models.ts";

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

async function pullUpdates(id: string, version: number) {
  console.log(` - pullUpdates(${id}, ${version})`);
  const updates = await streams.read(id, version, 5000);
  if (updates.length && updates[0].version !== version + 1) {
    return { status: "desync" };
  }
  return { status: "ok", updates: updates.map((u) => u.update) };
}

async function pushUpdates(id: string, version: number, updates: any[]) {
  console.log(` - pushUpdates(${id}, ${version}, [len: ${updates.length}])`);
  if (!(await streams.add(id, version, updates))) {
    return false;
  }
  await dirty.enqueue(id, Date.now() + compactionInterval, true);
  return true;
}

async function getDocumentInternal(id: string): Promise<{
  dbVersion: number;
  version: number;
  doc: string;
}> {
  let { version, doc: docS } = await checkpoints.load(id);
  let doc = Text.of(docS.split("\n"));
  const updates = await streams.read(id, version);
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

async function getDocument(id: string) {
  console.log(` - getDocuments(${id})`);
  const { version, doc } = await getDocumentInternal(id);
  return { version, doc };
}

/** Handle a client RPC message. */
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

async function runCompaction() {
  while (true) {
    const resp = await dirty.dequeue();
    if (resp === null) break;
    const { id, time } = resp;
    if (Date.now() < time) {
      await dirty.enqueue(id, time);
      break;
    }
    console.log(`Compacting doc:${id}`);
    try {
      const { dbVersion, version, doc } = await getDocumentInternal(id);
      if (dbVersion < version) {
        await checkpoints.save(id, doc, version);
      }
      if (!(await streams.trim(id, dbVersion))) {
        await dirty.enqueue(id, Date.now() + compactionInterval);
      }
    } catch (err: any) {
      await dirty.enqueue(id, time);
      throw err;
    }
  }
}

/** Periodically checkpoint old documents by reading the dirty list. */
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
