import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import ReconnectingWebSocket from "reconnecting-websocket";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import { unified } from "unified";

import initialText from "../content.txt?raw";
import { basicSetup, theme } from "./cmConfig";
import "./style.css";

const ws = new ReconnectingWebSocket(
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws"
);

ws.onmessage = (event) => {
  console.log(event);
};

ws.send("hello!");

function setText(text: string) {
  const output = document.getElementById("output")!;
  const file = unified().use(remarkParse).use(remarkHtml).processSync(text);
  output.innerHTML = String(file);
}

setText(initialText);

new EditorView({
  doc: initialText,
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
