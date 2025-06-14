import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { getSupervisor } from "@psibase/common-lib";

import { Toaster } from "@shared/shadcn/ui/sonner";

import { ThemeProvider } from "@/components/theme-provider";

import Router from "./router";

export const supervisor = getSupervisor();

export const queryClient = new QueryClient();

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
