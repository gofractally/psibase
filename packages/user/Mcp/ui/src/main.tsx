import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@shared/components/theme-provider";
import "@shared/styles/globals.css";

import { HomePage } from "./pages/home-page";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="system" storageKey="mcp-ui-theme">
                <HomePage />
            </ThemeProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
