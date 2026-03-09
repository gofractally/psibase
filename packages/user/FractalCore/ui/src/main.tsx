import { QueryClientProvider } from "@tanstack/react-query";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import duration from "dayjs/plugin/duration";
import localizedFormat from "dayjs/plugin/localizedFormat";
import timezone from "dayjs/plugin/timezone";
import { NuqsAdapter } from "nuqs/adapters/react-router/v6";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "@shared/components/theme-provider";
import { queryClient } from "@shared/lib/queryClient";
import { Toaster } from "@shared/shadcn/ui/sonner";

import { router } from "./router";

dayjs.extend(advancedFormat);
dayjs.extend(timezone);
dayjs.extend(duration);
dayjs.extend(localizedFormat);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <QueryClientProvider client={queryClient}>
                <NuqsAdapter>
                    <RouterProvider router={router} />
                </NuqsAdapter>
                <Toaster />
            </QueryClientProvider>
        </ThemeProvider>
    </StrictMode>,
);
