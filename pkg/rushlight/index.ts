import { Extension, Text } from "@codemirror/state";
import { DecorationSet } from "@codemirror/view";

import { Connection, getDocument, peerExtension } from "./collab";
import { Presence, defaultDecorations, presenceExtension } from "./presence";

export type { Presence, Connection };

export type ClientOptions = {
  /** An RPC connection that should send JSON messages to the server. */
  readonly connection: Connection;
  readonly clientID?: string;

  readonly presenceInterval?: number;
  readonly presenceExpiry?: number;
  readonly presenceDecorations?: (presences: Presence[]) => DecorationSet;
};

const defaultOptions = {
  presenceInterval: 5000,
  presenceExpiry: 8000,
  presenceDecorations: defaultDecorations,
};

export class CollabClient {
  private constructor(
    readonly initialDoc: Text,
    readonly extension: Extension,
    readonly presence: Extension
  ) {}

  static async of(options: ClientOptions) {
    const opts = { ...defaultOptions, ...options };
    const { version, doc } = await getDocument(options.connection);

    return new CollabClient(
      doc,
      peerExtension(version, options.connection),
      presenceExtension(
        opts.presenceInterval,
        opts.presenceExpiry,
        opts.presenceDecorations
      )
    );
  }
}
