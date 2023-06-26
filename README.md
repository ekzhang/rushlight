# cm-collab

A tiny [collaborative](https://codemirror.net/examples/collab/) text editing
library based on CodeMirror and Redis, with client and server.

Supports multiple real-time documents, with live cursors. Uses CodeMirror's
operational transformation extension. All changes are resolved by server code,
flexible for needs like authentication and rate limiting. Also, it's designed to
be as easy to integrate as possible (read: boring, non-proprietary). The backend
is stateless, using Redis, and _you can bring your own transport_; even a single
HTTP handler is enough!

Unlike most toy examples, this library supports durable persistence in any
database you choose. Documents are stored in Postgres, and real-time updates are
replicated over Redis, with automatic log compaction.

An experiment by [Eric Zhang](https://www.ekzhang.com/).

## Development

This is an NPM workspace. To build the libraries, just run:

```bash
npm install
npm run lint
npm run build
```

The demo collaborative editor application requires Node.js version 18 or higher
and Docker Compose.

```bash
docker compose up
npm run dev -w=app
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
