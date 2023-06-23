import express from "express";

import { compactionTask, handleMessage } from "./transform.ts";

const port = Number(process.env.PORT || 6471);

const app = express();
app.use(express.static("dist")); // Serve frontend files

app.post("/doc/:id", express.json(), async (req, res) => {
  const id = req.params.id;
  try {
    res.json(await handleMessage(id, req.body));
  } catch (e: any) {
    console.log("Failed to handle user message:", e.toString());
    res.status(400).send(e.toString());
  }
});

app.listen(port);

compactionTask();

console.log(`Server listening on port ${port}`);
