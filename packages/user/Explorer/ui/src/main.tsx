import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "@shared/components/theme-provider";
import { Toaster } from "@shared/shadcn/ui/sonner";
import { TooltipProvider } from "@shared/shadcn/ui/tooltip";

import { router } from "./router";

import "@shared/styles/globals.css";
import "./explorer.css";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
                <TooltipProvider delayDuration={150}>
                    <RouterProvider router={router} />
                </TooltipProvider>
                <Toaster />
            </ThemeProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
