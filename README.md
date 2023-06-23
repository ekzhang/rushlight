# cm-collab

A tiny [collaborative](https://codemirror.net/examples/collab/) Markdown editor
based on CodeMirror, communicating with a minimal WebSocket server and database.

Supports multiple real-time documents, with live cursors. Based on CodeMirror's
operational transformation extension. All changes are resolved by server code,
fully customizable for needs like authentication and rate limiting. Also, it's
designed to be as easy to integrate as possible (read: boring). The backend is
stateless and even avoids WebSockets by relying on HTTP/2.

Unlike most toy examples, this application persists data and cleans up database
memory. Documents are stored in Postgres, and real-time changes are resolved
over Redis, with compaction.

An experiment by [Eric Zhang](https://www.ekzhang.com/).

## Development

Requires Docker Compose and Node.js version 18 or higher.

```bash
docker compose up

npm install
npm run dev
```

Visit `http://localhost:6480` in your browser.

## Deployment

```bash
npm ci
npm run build

export REDIS_URL=redis://...
export DATABASE_URL=postgres://...
npm start
```

Listens on port 6471 by default, or the `PORT` environment variable if set.
