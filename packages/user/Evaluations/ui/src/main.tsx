import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "@shared/components/theme-provider";
import { queryClient } from "@shared/lib/queryClient";
import { Toaster } from "@shared/shadcn/ui/sonner";
import "@shared/styles/globals.css";

import { router } from "./router";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
                <RouterProvider router={router} />
                <Toaster />
            </ThemeProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
