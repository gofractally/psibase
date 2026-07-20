import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "@shared/components/theme-provider";
import { Toaster } from "@shared/shadcn/ui/sonner";
import "@shared/styles/globals.css";

import Router from "./router";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={Router} />
                <Toaster />
            </QueryClientProvider>
        </ThemeProvider>
    </StrictMode>,
);
