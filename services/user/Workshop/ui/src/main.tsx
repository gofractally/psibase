import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Supervisor } from "@psibase/common-lib";

import { Home, About, ManageAppMetadataPage } from "@routes";
import { TooltipProvider } from "@shadcn/tooltip";
import { Toaster } from "sonner";

import { SupervisorContext } from "@contexts/supervisor";
import DefaultLayout from "@layouts/default";

import "./styles/globals.css";

const queryClient = new QueryClient();
const supervisor = new Supervisor();

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
                path: "/register",
                element: <ManageAppMetadataPage />,
                children: [],
            },
            {
                path: "/register/:id",
                element: <ManageAppMetadataPage />,
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
            <SupervisorContext.Provider value={supervisor}>
                <TooltipProvider delayDuration={0}>
                    <RouterProvider router={router} />
                    <Toaster />
                </TooltipProvider>
            </SupervisorContext.Provider>
        </QueryClientProvider>
    </React.StrictMode>,
);
