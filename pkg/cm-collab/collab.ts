import {
  type Update,
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { addPresence, presenceFromJSON, presenceToJSON } from "./presence";

export type Connection = <T extends object, R>(value: T) => Promise<R>;

function pushUpdates(
  connection: Connection,
  version: number,
  fullUpdates: readonly Update[]
): Promise<boolean> {
  // Strip off transaction data
  let updates = fullUpdates.map((u) => ({
    clientID: u.clientID,
    changes: u.changes.toJSON(),
    effects: u.effects?.map((e) => presenceToJSON(e.value)),
  }));
  return connection({ type: "pushUpdates", version, updates });
}

async function pullUpdates(
  connection: Connection,
  version: number
): Promise<"desync" | readonly Update[]> {
  const resp: any = await connection({ type: "pullUpdates", version });
  if (resp.status === "desync") {
    return "desync";
  }
  return (resp.updates as Update[]).map((u) => ({
    changes: ChangeSet.fromJSON(u.changes),
    clientID: u.clientID,
    effects: u.effects?.map((e) => addPresence.of(presenceFromJSON(e))),
  }));
}

export async function getDocument(
  connection: Connection
): Promise<{ version: number; doc: Text }> {
  const data: any = await connection({ type: "getDocument" });
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
      private failures = 0;

      constructor(private view: EditorView) {
        this.pull();
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.transactions.some((tr) => tr.effects.length)
        ) {
          setTimeout(() => this.push(), 0);
        }
      }

      // Increment the failure count, and sleep with exponential backoff if 3
      // requests fail in a row.
      async failureSleep() {
        this.failures++;
        if (this.failures >= 3) {
          const delay = Math.pow(1.5, Math.min(this.failures - 3, 7)) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      async push() {
        let updates = sendableUpdates(this.view.state);
        if (this.pushing || !updates.length) return;
        this.pushing = true;
        let version = getSyncedVersion(this.view.state);
        try {
          await pushUpdates(connection, version, updates);
          this.failures = 0;
        } catch (e) {
          console.error(e);
          await this.failureSleep();
        }
        this.pushing = false;
        // Regardless of whether the push failed or new updates came in while it
        // was running, try again if there's updates remaining.
        if (sendableUpdates(this.view.state).length)
          setTimeout(() => this.push(), 100);
      }

      async pull() {
        while (!this.done) {
          const version = getSyncedVersion(this.view.state);
          try {
            const updates = await pullUpdates(connection, version);
            this.failures = 0;
            if (updates === "desync") {
              // This requires a full document reload. It only happens in rare
              // cases when network connection is lost for a long time.
              await this.fullReload();
            } else {
              this.view.dispatch(receiveUpdates(this.view.state, updates));
            }
          } catch (e) {
            console.error(e);
            await this.failureSleep();
          }
        }
      }

      async fullReload() {
        const { version, doc } = await getDocument(connection);
        const oldVersion = getSyncedVersion(this.view.state);
        const oldLength = sendableUpdates(this.view.state).reduce(
          (sum, u) => sum - u.changes.newLength + u.changes.length,
          this.view.state.doc.length
        );
        // Reload the document and bump its version to the latest.
        const changeSets: ChangeSet[] = [
          ChangeSet.of([{ from: 0, to: oldLength, insert: doc }], oldLength),
        ];
        for (let i = 1; i < version - oldVersion; i++) {
          changeSets.push(ChangeSet.empty(doc.length));
        }
        const updates = changeSets.map((c) => ({ changes: c, clientID: "" }));
        this.view.dispatch(receiveUpdates(this.view.state, updates));
      }

      destroy() {
        this.done = true;
      }
    }
  );

  const collabExtension = collab({
    startVersion,
    sharedEffects: (tr) => tr.effects.filter((e) => e.is(addPresence)),
  });

  return [collabExtension, plugin];
}
