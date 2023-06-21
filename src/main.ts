import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { nanoid } from "nanoid";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { basicSetup, theme } from "./cmConfig";
import { getDocument, peerExtension } from "./collab";
import { Connection } from "./connection";
import "./style.css";

// If there's no search string, generate one.
if (!window.location.search || window.location.search.length !== 6) {
  window.location.search = "?" + nanoid(5);
}

function setText(text: string) {
  const output = document.getElementById("output")!;
  const file = unified().use(remarkParse).use(remarkHtml).processSync(text);
  output.innerHTML = String(file);
}

const conn = new Connection(
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws" +
    window.location.search
);

async function main() {
  let { version, doc } = await getDocument(conn);

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
}

main();
