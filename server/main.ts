import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import { compactionTask, handleConnection } from "./transform.ts";

const port = Number(process.env.PORT || 6471);

const app = express();
app.use(express.static("dist")); // Serve frontend files

const server = createServer(app).listen(port);

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const matches = req.url!.match(/\/ws\/?\?([a-zA-Z-_0-9]+)$/);
  if (matches) {
    const id = matches[1];
    handleConnection(id, ws);
  }
});

compactionTask();

console.log(`Server listening on port ${port}`);
