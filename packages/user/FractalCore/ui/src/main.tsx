import { QueryClientProvider } from "@tanstack/react-query";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import duration from "dayjs/plugin/duration";
import timezone from "dayjs/plugin/timezone";
import { NuqsAdapter } from "nuqs/adapters/react-router/v6";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { ThemeProvider } from "@/components/theme-provider";

import { Toaster } from "@shared/shadcn/ui/sonner";

import { queryClient } from "./queryClient";
import { router } from "./router";
import { siblingUrl } from "@psibase/common-lib";
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";

dayjs.extend(advancedFormat);
dayjs.extend(timezone);
dayjs.extend(duration);

export const client = new ApolloClient({
    link: new HttpLink({ uri: siblingUrl(null, 'fractals', '/graphql') }),
    cache: new InMemoryCache(),
});


createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <QueryClientProvider client={queryClient}>
                <NuqsAdapter>
                    <ApolloProvider client={client}>

                        <RouterProvider router={router} />
                    </ApolloProvider>
                </NuqsAdapter>
                <Toaster />
            </QueryClientProvider>
        </ThemeProvider>
    </StrictMode>,
);
