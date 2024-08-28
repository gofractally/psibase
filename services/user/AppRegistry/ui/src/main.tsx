import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Home, About } from "@routes";
import { TooltipProvider } from "@shadcn/tooltip";

import DefaultLayout from "./layouts/default";

import "./styles/globals.css";

const queryClient = new QueryClient();

const router = createHashRouter([
    {
        element: <DefaultLayout />,
        children: [
            {
                path: "/",
                element: <Home />,
                children: [],
            },
            {
                path: "/about",
                element: <About />,
                children: [],
            },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={0}>
                <RouterProvider router={router} />
            </TooltipProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
