import { Update } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import { ErrorReply, defineScript } from "@redis/client";
import { WebSocket } from "ws";

import { redis, sql } from "./db.ts";

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
  redis.call("XADD", KEYS[1], "0-" .. (version + i - 1), "d", ARGV[i])
end`,
  transformArguments: () => [], // not needed
});

async function pullUpdates(id: string, version: number) {
  console.log(` - pullUpdates(${id}, ${version})`);
  const entries = await redis.executeIsolated((redis) =>
    redis.xRead(
      { key: `doc:${id}`, id: `0-${version}` },
      { BLOCK: 5000, COUNT: 512 }
    )
  );
  const updates = entries?.[0]?.messages ?? [];
  if (updates.length && updates[0].id !== `0-${version + 1}`) {
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

  const entries = await redis.xRead({ key: `doc:${id}`, id: `0-${version}` });
  const updates = entries?.[0]?.messages ?? [];
  if (updates.length && updates[0].id !== `0-${version + 1}`) {
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
