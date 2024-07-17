import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { MilkdownProvider } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";

import {
    Drafts,
    Editor,
    Home,
    homeLoader,
    Post,
    postLoader,
    Sent,
    Viewer,
} from "@routes";
import { TooltipProvider } from "@shadcn/tooltip";

import DefaultLayout from "./layouts/default";

import "./styles/globals.css";

const router = createHashRouter([
    {
        element: <DefaultLayout />,
        children: [
            {
                path: "/",
                element: <Home />,
                loader: homeLoader,
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
            {
                path: "posts/:postId",
                element: <Post />,
                loader: postLoader,
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
        <TooltipProvider delayDuration={0}>
            <MilkdownProvider>
                <ProsemirrorAdapterProvider>
                    <RouterProvider router={router} />
                </ProsemirrorAdapterProvider>
            </MilkdownProvider>
        </TooltipProvider>
    </React.StrictMode>,
);
