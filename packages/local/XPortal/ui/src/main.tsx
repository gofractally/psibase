import { QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@shared/components/theme-provider";
import { queryClient } from "@shared/lib/query-client";
import "@shared/styles/globals.css";

import { App } from "./app";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <div className="flex min-h-dvh w-full items-center justify-center p-4">
                <div className="w-full min-w-0">
                    <App />
                </div>
            </div>
        </ThemeProvider>
    </QueryClientProvider>,
);
