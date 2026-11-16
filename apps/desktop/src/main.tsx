import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { StudiodProvider } from "@/StudiodProvider";
import { TooltipProvider } from "@/components/ui/Tooltip";
import "@/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudiodProvider>
      {/* one provider: moving between adjacent tooltips skips the delay */}
      <TooltipProvider delayDuration={350} skipDelayDuration={250}>
        <App />
      </TooltipProvider>
    </StudiodProvider>
  </StrictMode>,
);
