import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";

import { ThemeProvider } from "@/components/theme-provider";

import { Routing } from "./routing";

export const queryClient = new QueryClient();

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
