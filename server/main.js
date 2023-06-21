import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8080);

const app = express();
app.use(express.static("dist"));

const server = createServer(app).listen(port);

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", function connection(ws) {
  ws.on("error", console.error);

  ws.on("message", function message(data) {
    console.log("received: %s", data);
  });

  ws.send("something");
});

console.log(`Server listening on port ${port}`);
