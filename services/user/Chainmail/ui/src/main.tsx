import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MilkdownProvider } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";

import { Drafts, Editor, Home, Sent, Viewer } from "@routes";
import { TooltipProvider } from "@shadcn/tooltip";

import DefaultLayout from "./layouts/default";

import "./styles/globals.css";

const queryClient = new QueryClient();

const router = createBrowserRouter([
    {
        element: <DefaultLayout />,
        children: [
            {
                path: "/",
                element: <Home />,
                children: [],
            },
            {
                path: "/drafts",
                element: <Drafts />,
                children: [],
            },
            {
                path: "/sent",
                element: <Sent />,
                children: [],
            },
        ],
    },
    {
        path: "editor",
        element: <Editor />,
    },
    {
        path: "viewer",
        element: <Viewer />,
    },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={0}>
                <MilkdownProvider>
                    <ProsemirrorAdapterProvider>
                        <RouterProvider router={router} />
                    </ProsemirrorAdapterProvider>
                </MilkdownProvider>
            </TooltipProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
