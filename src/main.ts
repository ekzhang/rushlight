import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { basicSetup, theme } from "./cmConfig";
import { getDocument, peerExtension } from "./collab";
import { Connection } from "./connection";
import "./style.css";

const conn = new Connection(
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws"
);

let { version, doc } = await getDocument(conn);

function setText(text: string) {
  const output = document.getElementById("output")!;
  const file = unified().use(remarkParse).use(remarkHtml).processSync(text);
  output.innerHTML = String(file);
}

setText(doc.toString());

new EditorView({
  doc,
  extensions: [
    theme,
    basicSetup,
    EditorView.lineWrapping,
    markdown(),
    peerExtension(version, conn),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setText(update.state.doc.toString());
      }
    }),
  ],
  parent: document.getElementById("editor")!,
});
