import "./style.css";

import {
  // lineNumbers,
  // highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  // highlightActiveLine,
  keymap,
} from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  // foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldKeymap,
} from "@codemirror/language";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  closeBrackets,
  autocompletion,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { markdown } from "@codemirror/lang-markdown";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkHtml from "remark-html";

const pipeline = unified().use(remarkParse).use(remarkHtml);

function setText(text: string) {
  const output = document.getElementById("output")!;
  const file = pipeline.processSync(text);
  output.innerHTML = String(file);
}

const parent = document.getElementById("editor")!;

const theme = EditorView.theme({
  "&": {
    fontSize: "13pt",
    border: "1px solid #e8e8e8",
    padding: "8px",
    backgroundColor: "#fafafa",
    borderRadius: "6px",
  },
  "&.cm-focused": {
    outline: "none",
    border: "1px solid #d0d0d0",
  },
  ".cm-content": {
    fontFamily: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`,
    // fontFamily: "Menlo, Monaco, Lucida Console, monospace",
  },
});

// This is customized from the "codemirror" basicSetup extension.
const basicSetup = [
  // lineNumbers(),
  // highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  // foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  // highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
];

let view = new EditorView({
  extensions: [
    theme,
    basicSetup,
    EditorView.lineWrapping,
    markdown(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setText(update.state.doc.toString());
      }
    }),
  ],
  parent,
});

view.dispatch({
  changes: {
    from: 0,
    to: view.state.doc.length,
    insert: `# CodeMirror Collaboration

This is a collaborative **Markdown** editor shared by all viewers of this page, who are connected to the backend.

Type here to see the output rendered below.`,
  },
});
