import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { basicSetup, theme } from "./cmConfig";
import "./style.css";

function setText(text: string) {
  const output = document.getElementById("output")!;
  const file = unified().use(remarkParse).use(remarkHtml).processSync(text);
  output.innerHTML = String(file);
}

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
  parent: document.getElementById("editor")!,
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
