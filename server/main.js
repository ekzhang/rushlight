import { ChangeSet, Text } from "@codemirror/state";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8080);

const app = express();
app.use(express.static("dist"));

const server = createServer(app).listen(port);

const wss = new WebSocketServer({ server, path: "/ws" });

// The updates received so far (updates.length gives the current version)
/** @type {import("@codemirror/collab").Update[]} */
let updates = [];

// The current document
const initialText = `# CodeMirror Collaboration

This is a collaborative **Markdown** editor shared by all viewers of this page, who are connected to the backend.

Type here to see the output rendered below.

Source code is available [here](https://github.com/ekzhang/cm-collab).`;
let doc = Text.of(initialText.split("\n"));

/** @type {((value: any) => void)[]} */
let pending = [];

function handleMessage(ws, message) {
  const data = JSON.parse(message.toString());
  console.log("Received:", data);

  const resp = (value) => {
    ws.send(JSON.stringify({ id: data.id, value }));
  };

  if (data.type == "pullUpdates") {
    if (data.version < updates.length) {
      resp(updates.slice(data.version));
    } else {
      pending.push(resp);
    }
  } else if (data.type == "pushUpdates") {
    if (data.version != updates.length) {
      resp(false);
    } else {
      for (let update of data.updates) {
        // Convert the JSON representation to an actual ChangeSet instance
        let changes = ChangeSet.fromJSON(update.changes);
        updates.push({ changes, clientID: update.clientID });
        doc = changes.apply(doc);
      }
      resp(true);
      // Notify pending requests
      while (pending.length) pending.pop()(data.updates);
    }
  } else if (data.type == "getDocument") {
    resp({ version: updates.length, doc: doc.toString() });
  }
}

wss.on("connection", (ws) => {
  console.log("New connection");
  ws.on("error", console.error);
  ws.on("message", (message) => {
    try {
      handleMessage(ws, message);
    } catch (e) {
      console.log("Failed to handle user message:", e.toString());
      return;
    }
  });
});

console.log(`Server listening on port ${port}`);
