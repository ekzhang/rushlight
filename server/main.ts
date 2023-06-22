import { Update } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import express from "express";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8080);

const app = express();
app.use(express.static("dist"));

const server = createServer(app).listen(port);

const wss = new WebSocketServer({ server, path: "/ws" });

const initialText = `# CodeMirror Collaboration

This is a collaborative **Markdown** editor shared by all viewers of this page. You just opened a new document, with your own personal link!

Type here to see the output rendered below.

Source code is available [here](https://github.com/ekzhang/cm-collab).`;

class Document {
  // The updates received so far (updates.length gives the current version)
  updates: Update[] = [];

  // The current document
  doc = Text.of(initialText.split("\n"));

  // Requests waiting for updates
  pending: ((value: any) => void)[] = [];

  handleMessage(ws: WebSocket, message: ArrayBuffer) {
    const data = JSON.parse(message.toString());
    console.log("Received:", data);

    const resp = (value: any) => {
      ws.send(JSON.stringify({ id: data.id, value }));
    };

    if (data.type == "pullUpdates") {
      if (data.version < this.updates.length) {
        resp(this.updates.slice(data.version));
      } else {
        this.pending.push(resp);
      }
    } else if (data.type == "pushUpdates") {
      if (data.version != this.updates.length) {
        resp(false);
      } else {
        for (let update of data.updates) {
          // Convert the JSON representation to an actual ChangeSet instance
          let changes = ChangeSet.fromJSON(update.changes);
          this.updates.push({ changes, clientID: update.clientID });
          this.doc = changes.apply(this.doc);
        }
        resp(true);
        // Notify pending requests
        while (this.pending.length) {
          this.pending.pop()!(data.updates);
        }
      }
    } else if (data.type == "getDocument") {
      resp({ version: this.updates.length, doc: this.doc.toString() });
    }
  }
}

const documents: Map<string, Document> = new Map();

wss.on("connection", (ws, req) => {
  const matches = req.url!.match(/\/ws\/?\?([a-zA-Z-_0-9]+)$/);
  if (matches) {
    const id = matches[1];
    console.log("New connection to document", id);

    let doc = documents.get(id);
    if (!doc) {
      doc = new Document();
      documents.set(id, doc);
    }

    ws.on("error", console.error);
    ws.on("message", (message) => {
      try {
        doc!.handleMessage(ws, message as Buffer);
      } catch (e: any) {
        console.log("Failed to handle user message:", e.toString());
        return;
      }
    });
  }
});

console.log(`Server listening on port ${port}`);
