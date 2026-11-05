import { QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@shared/components/theme-provider";
import { queryClient } from "@shared/lib/query-client";
import { Toaster } from "@shared/shadcn/ui/sonner";
import "@shared/styles/globals.css";

import { App } from "./app";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <App />
            <Toaster />
        </ThemeProvider>
    </QueryClientProvider>,
);
