# cm-collab

A tiny [collaborative](https://codemirror.net/examples/collab/) Markdown editor
based on CodeMirror, communicating with a minimal WebSocket server and database.

Supports multiple real-time documents, with live cursors. Based on CodeMirror's
operational transformation extension. All coordination is handled by server
code, fully customizable for needs like authentication and rate limiting.

Unlike most toy examples, the backend is stateless. All documents are stored in
Postgres, and real-time changes are resolved over Redis, with compaction.

An experiment by [Eric Zhang](https://www.ekzhang.com/).

## Development

Requires Docker Compose and Node.js version 18 or higher.

```bash
docker compose up

npm install
npm run dev
```

Visit `http://localhost:7680` in your browser.

## Deployment

```bash
npm ci
npm run build

export REDIS_URL=redis://...
export DATABASE_URL=postgres://...
npm start
```

Listens on port 7671 by default, or the `PORT` environment variable if set.
