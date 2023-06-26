import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { CollabClient } from "cm-collab";
import { nanoid } from "nanoid";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { basicSetup, theme } from "./cmConfig";
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

async function main() {
  const endpoint = "/doc/" + window.location.search.substring(1);

  const collab = await CollabClient.of({
    async connection(message) {
      console.log("sending message", message);
      const resp = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify(message),
        headers: { "Content-Type": "application/json" },
      });
      if (resp.status !== 200) {
        throw new Error(`Request failed with status ${resp.status}`);
      }
      return await resp.json();
    },
  });

  setText(collab.initialDoc.toString());

  new EditorView({
    doc: collab.initialDoc,
    extensions: [
      theme,
      basicSetup,
      EditorView.lineWrapping,
      markdown(),
      collab,
      collab.presence,
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
