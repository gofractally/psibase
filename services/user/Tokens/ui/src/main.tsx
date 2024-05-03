import App from "./App.tsx";
import { SupervisorContext } from "./context.tsx";
import "./index.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Supervisor } from "@psibase/common-lib/messaging/supervisor.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

const queryClient = new QueryClient();
const supervisor = new Supervisor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SupervisorContext.Provider value={supervisor}>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <App />
          <Toaster toastOptions={{ className: "border border-muted" }} />
        </ThemeProvider>
      </SupervisorContext.Provider>
    </QueryClientProvider>
  </React.StrictMode>
);
