import { getClientID } from "@codemirror/collab";
import {
  EditorSelection,
  EditorState,
  Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";

export type Presence = {
  selection: EditorSelection;
  focused: boolean;
  clientID: string;
};

export function presenceToJSON({ selection, focused, clientID }: Presence) {
  return {
    selection: selection.toJSON(),
    focused,
    clientID,
  };
}

export function presenceFromJSON(value: any) {
  return {
    selection: EditorSelection.fromJSON(value.selection),
    focused: value.focused,
    clientID: value.clientID,
  };
}

export const addPresence = StateEffect.define<Presence>({
  map({ selection, focused, clientID }: Presence, changes) {
    return {
      selection: selection.map(changes),
      focused,
      clientID,
    };
  },
});

type PresenceWithTime = Presence & { time: number };

type PresenceSet = PresenceWithTime[];

class CursorWidget extends WidgetType {
  constructor(readonly hue: number) {
    super();
  }
  toDOM(): HTMLElement {
    let el = document.createElement("span");
    el.setAttribute("aria-hidden", "true");
    el.style.position = "absolute";
    el.style.borderLeft =
      el.style.borderRight = `1px solid hsl(${this.hue} 90% 40%)`;
    el.style.marginTop = "1.5px";
    el.style.height = "1.2em";
    return el;
  }
  eq(widget: WidgetType): boolean {
    return (widget as CursorWidget).hue === this.hue;
  }
  get estimatedHeight(): number {
    return 0;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export function defaultDecorations(presences: Presence[]) {
  const decorations: Range<Decoration>[] = [];
  for (const { selection, focused, clientID } of presences) {
    // Ignore selections when the editor is not focused.
    if (!focused) continue;

    // Compute a deterministic number from the client ID.
    let hue = 0;
    for (let i = 0; i < clientID.length; i++)
      hue = Math.imul(hue + clientID.charCodeAt(i), 595438061) % 360;
    const cursorWidget = Decoration.widget({
      widget: new CursorWidget(hue),
    });
    const underlineMark = Decoration.mark({
      attributes: {
        style: `background-color: hsl(${hue} 90% 40% / 0.15)`,
      },
    });
    decorations.push(cursorWidget.range(selection.main.head));
    for (const range of selection.ranges) {
      if (!range.empty) {
        decorations.push(underlineMark.range(range.from, range.to));
      }
    }
  }
  return Decoration.set(decorations, true);
}

export function presenceExtension(
  presenceInterval: number,
  presenceExpiry: number,
  presenceDecorations: (presences: Presence[]) => DecorationSet
) {
  // Store presence information and display it as editor decorations.
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
          newPresenceSet.push({ ...p, selection: p.selection.map(tr.changes) });
        }
      }
      return newPresenceSet;
    },
    provide(self) {
      return EditorView.decorations.from(self, presenceDecorations);
    },
  });

  // Attach an effect to transactions that set the selection.
  const presenceFilter = EditorState.transactionFilter.of((tr) => {
    if (tr.selection && !tr.state.readOnly) {
      const effect = addPresence.of({
        selection: tr.selection,
        focused: true,
        clientID: getClientID(tr.state),
      });
      return { ...tr, effects: [...tr.effects, effect] };
    }
    return tr;
  });

  const sendPresence = (view: EditorView) => {
    const effect = addPresence.of({
      selection: view.state.selection,
      focused: view.hasFocus,
      clientID: getClientID(view.state),
    });
    view.dispatch({ effects: effect });
  };

  // Send the presence effect at regular intervals to maintain liveness, but
  // only while the editor is focused.
  const presenceTimer = ViewPlugin.define((view) => {
    const timer = setInterval(() => {
      if (view.hasFocus && !view.state.readOnly) {
        sendPresence(view);
      }
    }, presenceInterval);
    return { destroy: () => clearInterval(timer) };
  });

  // Send the presence effect when the editor is blurred.
  const presenceBlur = EditorView.domEventHandlers({
    blur: (_event, view) => {
      if (!view.state.readOnly) {
        sendPresence(view);
      }
    },
  });

  return [presenceField, presenceFilter, presenceTimer, presenceBlur];
}
