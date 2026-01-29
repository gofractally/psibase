import React from "react";
import ReactDOM from "react-dom/client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ThemeProvider } from "@/components/theme-provider";
import { LoginRequired } from "@/components";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
                <LoginRequired>
                    <App />
                </LoginRequired>
            </ThemeProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
