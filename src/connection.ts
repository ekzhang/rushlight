import { nanoid } from "nanoid";
import ReconnectingWebSocket from "reconnecting-websocket";

/** A simple implementation of reconnecting WebSocket-based RPC. */
export class Connection {
  private ws: ReconnectingWebSocket;
  private handlers: Map<string, (value: any) => void> = new Map();

  constructor(uri: string) {
    this.ws = new ReconnectingWebSocket(uri);
    this.handlers = new Map();

    this.ws.onerror = console.warn;

    this.ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const { id, value } = JSON.parse(event.data);
        const handler = this.handlers.get(id);
        if (handler) {
          this.handlers.delete(id);
          handler(value);
        }
      }
    };
  }

  request<T extends object, R>(value: T): Promise<R> {
    const id = nanoid();
    console.log("sending message", value);
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify({ id, ...value }));
      this.handlers.set(id, resolve);
      window.setTimeout(() => {
        if (this.handlers.delete(id)) {
          reject(new Error("request timed out"));
        }
      }, 5000); // 5-second timeout
    });
  }
}
