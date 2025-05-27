import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/globals.css";
import { App } from "./App";
import { ThemeProvider } from "@components/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        </ThemeProvider>
    </React.StrictMode>,
);
