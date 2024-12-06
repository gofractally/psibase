import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import "./index.css";
import router from "./router";
import { Supervisor, siblingUrl } from "@psibase/common-lib";

export const queryClient = new QueryClient();

const supervisorSrc = siblingUrl(undefined, "supervisor", undefined, false);

export const supervisor = new Supervisor({
    supervisorSrc,
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
            <Toaster />
        </QueryClientProvider>
    </ThemeProvider>
);
