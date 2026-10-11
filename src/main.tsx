import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary area="app" label="Physics Lab">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
