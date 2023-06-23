import { Update } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import { ErrorReply, defineScript } from "@redis/client";
import { WebSocket } from "ws";

import { redis, sql } from "./db.ts";

const compactionDelay = 1000 * 30; // 30 seconds

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

async function pullUpdates(id: string, version: number) {
  console.log(` - pullUpdates(${id}, ${version})`);
  const entries = await redis.executeIsolated((redis) =>
    redis.xRead(
      { key: `doc:${id}`, id: `${version}-0` },
      { BLOCK: 5000, COUNT: 512 }
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

async function pushUpdates(id: string, version: number, updates: Update[]) {
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
  await redis.zAdd("doc-dirty", { score: Date.now(), value: id });
  return true;
}

async function getDocument(id: string) {
  console.log(` - getDocuments(${id})`);

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
    version++;
  }
  return { version, doc: doc.toString() };
}

export function handleConnection(id: string, ws: WebSocket) {
  console.log("New connection to document", id);

  ws.on("error", console.error);
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      let value = null;
      if (data.type == "pullUpdates") {
        value = await pullUpdates(id, data.version);
      } else if (data.type == "pushUpdates") {
        const updates: Update[] = data.updates.map((u: any) => ({
          changes: ChangeSet.fromJSON(u.changes),
          clientID: u.clientID,
        }));
        value = await pushUpdates(id, data.version, updates);
      } else if (data.type == "getDocument") {
        value = await getDocument(id);
      }
      ws.send(JSON.stringify({ id: data.id, value }));
    } catch (e: any) {
      console.log("Failed to handle user message:", e.toString());
      return;
    }
  });
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
    await new Promise((resolve) => setTimeout(resolve, 0.1 * compactionDelay));
  }
}

async function runCompaction() {
  while (true) {
    const resp = await redis.zmPop("doc-dirty", "MIN");
    if (resp === null) {
      break;
    }
    const { score, value: id } = resp.elements[0];
    if (Date.now() - score < compactionDelay) {
      await redis.zAdd("doc-dirty", { score, value: id }, { NX: true });
      break;
    }
    console.log(`Compacting doc:${id}`);
    try {
      const { version, doc } = await getDocument(id);
      await sql`
        INSERT INTO
          documents (id, content, version)
        VALUES
          (${id}, ${doc}, ${version})
        ON CONFLICT (id) DO UPDATE SET
          content = excluded.content,
          version = excluded.version
      `;
      await redis.xTrim(`doc:${id}`, "MINID", version + 1, {
        strategyModifier: "~",
      });
    } catch (err: any) {
      await redis.zAdd("doc-dirty", { score, value: id }, { NX: true });
      throw err;
    }
  }
}
