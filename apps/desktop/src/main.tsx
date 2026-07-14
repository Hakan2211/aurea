import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { StudiodProvider } from "@/StudiodProvider";
import "@/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudiodProvider>
      <App />
    </StudiodProvider>
  </StrictMode>,
);
