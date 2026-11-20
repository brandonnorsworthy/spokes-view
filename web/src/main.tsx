import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { kanbanRootFrom } from "./kanban";
import { KanbanApp } from "./KanbanApp";
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("missing #root");
const search = window.location.search;
const board = kanbanRootFrom(search);
createRoot(el).render(
  <StrictMode>
    {board === null ? (
      <App />
    ) : (
      <KanbanApp server={new URLSearchParams(search).get("server")} rootId={board} />
    )}
  </StrictMode>,
);
