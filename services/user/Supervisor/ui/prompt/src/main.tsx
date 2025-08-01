import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
                <App />
            </ThemeProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
