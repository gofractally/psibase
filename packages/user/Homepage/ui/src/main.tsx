import { QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "@shared/components/theme-provider";
import { queryClient } from "@shared/lib/query-client";
import { Toaster } from "@shared/shadcn/ui/sonner";
import "@shared/styles/globals.css";

import router from "./router";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
            <Toaster />
        </QueryClientProvider>
    </ThemeProvider>,
);
