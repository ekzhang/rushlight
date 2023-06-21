# cm-collab

Basic demo app for a [collaborative](https://codemirror.net/examples/collab/)
Markdown editor based on CodeMirror, communicating with a Node.js backend server
over WebSocket.

Supports multiple real-time documents, with live cursors. Based on CodeMirror's
operational transformation extension. What's nice is that all other control and
communication logic is handled by server code, fully customizable to suit
application needs like authentication and rate limiting.

An experiment by [Eric Zhang](https://www.ekzhang.com/).

## Development

Requires Node.js version 18 or higher.

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` in your browser.

## Deployment

```bash
npm ci
npm run build
npm start
```

Listens on port 8080 by default, or the `PORT` environment variable if set.
