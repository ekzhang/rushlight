# cm-collab

**Collaborative text editor on your own infrastructure: just Redis and a
database.**

Supports multiple real-time documents, with live cursors. Based on
[CodeMirror](https://codemirror.net/)'s operational transformation
[extension](https://codemirror.net/examples/collab/), so all changes are
resolved by server code. Also, it's designed to be as easy to integrate as
possible (read: boring). The backend is stateless, and _you can bring your own
transport_; even a single HTTP handler is enough!

Unlike most toy examples, this library supports persistence in any durable
database you choose. Real-time updates are replicated by Redis, with automatic
log compaction.

An experiment by [Eric Zhang](https://www.ekzhang.com/), author of
[Rustpad](https://github.com/ekzhang/rustpad).

## Motivation

Real-time collaborative editing can be embedded in many web applications, where
you generally already have a database. However, most libraries are unsuitable
because they:

- Require proprietary gadgets
- Are not flexible enough, e.g., to customize appearance
- Make you subscribe to a cloud service where you can't control the data
- Use decentralized algorithms like CRDTs that are hard to reason about
- Make it difficult to authenticate users or apply rate limits
- Rely on a single stateful server, which breaks with replication / horizontal
  autoscaling
- Need WebSockets or other protocols that aren't supported by some providers
- Are just generally too opinionated

This library tries to take a different approach.

## Usage

Install the client and server packages.

```bash
# client
npm install cm-collab

# server
npm install cm-collab-server
```

On the frontend, create a `CollabClient` object and attach it to your CodeMirror
instance via extensions.

```ts
import { CollabClient } from "cm-collab";
import { EditorView } from "codemirror";

const collab = await CollabClient.of({
  async connection(message) {
    // You can use any method to send messages to the server. This example
    // executes a simple POST request.
    const resp = await fetch(`/doc/${id}`, {
      method: "POST",
      body: JSON.stringify(message),
      headers: { "Content-Type": "application/json" },
    });
    if (resp.status !== 200) {
      throw new Error(`Request failed with status ${resp.status}`);
    }
    return await resp.json();
  },
});

const view = new EditorView({
  extensions: [
    // ...
    collab,
    collab.presence, // Optional, if you want to show remote cursors.
  ],
  // ...
});
```

Then, on the server, we need to write a corresponding handler for the POST
request. Create a `CollabServer` object, which requires a Redis connection
string and a persistent database for document storage.

The example below is with `express`, but you can use any framework.

```ts
import { Checkpoint, CollabServer } from "cm-collab-server";
import express from "express";

const collab = await CollabServer.of({
  redisUrl: process.env.REDIS_URL || "redis://localhost:6473",
  async loadCheckpoint(id: string): Promise<Checkpoint> {
    // ... Load the document from your database.
    return { version, doc };
  },
  async saveCheckpoint(id: string, { version, doc }: Checkpoint) {
    // ... Save the new version of the document to your database.
  },
});

collab.compactionTask(); // Run this asynchronously.

const app = express();

app.post("/doc/:id", express.json(), async (req, res) => {
  const id = req.params.id;
  try {
    res.json(await collab.handle(id, req.body));
  } catch (e: any) {
    console.log("Failed to handle user message:", e.toString());
    res.status(400).send(e.toString());
  }
});

app.listen(8080);
```

That's it! See the `ClientOptions` and `ServerOptions` types for more
configuration options.

To view a full demo application, a collaborative Markdown editor using Postgres
to store documents, see the [`app/`](app/) folder in this repository.

## Development

These are instructions for developing the library itself and running the demo
application. Clone the repository, which is an NPM workspace. To build the
TypeScript files, just run:

```bash
npm install
npm run lint
npm run build
```

The demo application requires Node.js version 18 or higher and Docker Compose.

```bash
docker compose up
npm run dev
```

Visit `http://localhost:6480` in your browser.

## Deployment

For the demo application:

```bash
npm ci
npm run build

export REDIS_URL=redis://...
export DATABASE_URL=postgres://...
npm start -w=app
```

Listens on port 6471 by default, or the `PORT` environment variable if set.
