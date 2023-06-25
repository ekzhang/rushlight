import { getClientID } from "@codemirror/collab";
import {
  EditorSelection,
  Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

const presenceThrottle = 4000; // Only resend selection every 4 seconds.
const presenceExpiry = 8000; // Presence expires after 8 seconds.

type Presence = {
  selection: EditorSelection;
  clientID: string;
};

export function presenceToJSON({ selection, clientID }: Presence) {
  return {
    selection: selection.toJSON(),
    clientID,
  };
}

export function presenceFromJSON(value: any) {
  return {
    selection: EditorSelection.fromJSON(value.selection),
    clientID: value.clientID,
  };
}

export const addPresence = StateEffect.define<Presence>({
  map({ selection, clientID }: Presence, changes) {
    return {
      selection: selection.map(changes),
      clientID,
    };
  },
});

type PresenceWithTime = Presence & { time: number };

type PresenceSet = PresenceWithTime[];

class CursorWidget extends WidgetType {
  toDOM(): HTMLElement {
    let el = document.createElement("span");
    el.setAttribute("aria-hidden", "true");
    el.className = "cm-presence-cursor";
    return el;
  }
  get estimatedHeight(): number {
    return 0;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const presenceField = StateField.define<PresenceSet>({
  create() {
    return [];
  },
  update(presenceSet, tr) {
    const now = Date.now();
    const me = getClientID(tr.state);
    const byId = new Map<string, PresenceWithTime>();
    for (const e of tr.effects) {
      if (e.is(addPresence) && e.value.clientID !== me) {
        byId.set(e.value.clientID, { ...e.value, time: now });
      }
    }
    const newPresenceSet = [...byId.values()];
    for (const p of presenceSet) {
      if (p.time >= now - presenceExpiry && !byId.has(p.clientID)) {
        newPresenceSet.push({
          ...p,
          selection: p.selection.map(tr.changes, 1),
        });
      }
    }
    return newPresenceSet;
  },
  provide(self) {
    return EditorView.decorations.from(self, (presenceSet: PresenceSet) => {
      const decorations: Range<Decoration>[] = [];
      for (const { selection, clientID } of presenceSet) {
        void clientID;
        const cursorWidget = Decoration.widget({ widget: new CursorWidget() });
        const underlineMark = Decoration.mark({ class: "cm-presence" });
        decorations.push(cursorWidget.range(selection.main.head));
        for (const range of selection.ranges) {
          if (!range.empty) {
            decorations.push(underlineMark.range(range.from, range.to));
          }
        }
      }
      return Decoration.set(decorations, true);
    });
  },
});

export function presencePlugin() {
  let lastPresence = 0;
  const presenceListener = EditorView.updateListener.of((update) => {
    const now = Date.now();
    if (update.selectionSet || now - lastPresence > presenceThrottle) {
      lastPresence = now;
      const myPresence = addPresence.of({
        selection: update.state.selection,
        clientID: getClientID(update.state),
      });
      update.view.dispatch({ effects: myPresence });
    }
  });
  return [presenceField, presenceListener];
}
