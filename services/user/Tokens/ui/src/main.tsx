import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getSupervisor } from "@psibase/common-lib";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

export const queryClient = new QueryClient();
export const supervisor = getSupervisor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <App />
        <Toaster toastOptions={{ className: "border border-muted" }} />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
