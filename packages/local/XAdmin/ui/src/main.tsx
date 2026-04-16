import { QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";

import { ThemeProvider } from "@shared/components/theme-provider";
import { queryClient } from "@shared/lib/query-client";
import "@shared/styles/globals.css";

import { Routing } from "./routing";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <Toaster />
            <HashRouter>
                <Routing />
            </HashRouter>
        </ThemeProvider>
    </QueryClientProvider>,
);
