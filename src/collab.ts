import {
  type Update,
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

import type { Connection } from "./connection";

function pushUpdates(
  connection: Connection,
  version: number,
  fullUpdates: readonly Update[]
): Promise<boolean> {
  // Strip off transaction data
  let updates = fullUpdates.map((u) => ({
    clientID: u.clientID,
    changes: u.changes.toJSON(),
  }));
  return connection.request({ type: "pushUpdates", version, updates });
}

async function pullUpdates(
  connection: Connection,
  version: number
): Promise<readonly Update[]> {
  const resp: any = await connection.request({ type: "pullUpdates", version });
  if (resp.status === "desync") {
    window.alert("Server out of sync, reloading to recover");
    window.location.reload();
  }
  return (resp.updates as Update[]).map((u) => ({
    changes: ChangeSet.fromJSON(u.changes),
    clientID: u.clientID,
  }));
}

export async function getDocument(
  connection: Connection
): Promise<{ version: number; doc: Text }> {
  const data: any = await connection.request({ type: "getDocument" });
  return {
    version: data.version,
    doc: Text.of(data.doc.split("\n")),
  };
}

export function peerExtension(startVersion: number, connection: Connection) {
  let plugin = ViewPlugin.fromClass(
    class {
      private pushing = false;
      private done = false;

      constructor(private view: EditorView) {
        this.pull();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.push();
      }

      async push() {
        let updates = sendableUpdates(this.view.state);
        if (this.pushing || !updates.length) return;
        this.pushing = true;
        let version = getSyncedVersion(this.view.state);
        try {
          await pushUpdates(connection, version, updates);
        } catch (e) {} // Ignore failures
        this.pushing = false;
        // Regardless of whether the push failed or new updates came in
        // while it was running, try again if there's updates remaining
        if (sendableUpdates(this.view.state).length)
          setTimeout(() => this.push(), 100);
      }

      async pull() {
        while (!this.done) {
          let version = getSyncedVersion(this.view.state);
          try {
            let updates = await pullUpdates(connection, version);
            this.view.dispatch(receiveUpdates(this.view.state, updates));
          } catch (e) {} // Ignore failures, long polling
        }
      }

      destroy() {
        this.done = true;
      }
    }
  );
  return [collab({ startVersion }), plugin];
}
