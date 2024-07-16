import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";
import "./styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import { Routing } from "./routing";
import { Toaster } from "@/components/ui/toaster";

export const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <Toaster />
            <HashRouter>
                <Routing />
            </HashRouter>
        </ThemeProvider>
    </QueryClientProvider>
);
