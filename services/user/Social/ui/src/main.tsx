import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";

import { Home, homeLoader, Post, postLoader } from "@routes";
import { TooltipProvider } from "@shadcn/tooltip";

import DefaultLayout, { accountsLoader } from "./layouts/default";

import "./styles/globals.css";

const router = createHashRouter([
    {
        element: <DefaultLayout />,
        loader: accountsLoader,
        children: [
            {
                path: "/",
                element: <Home />,
                loader: homeLoader,
                children: [],
            },
            {
                path: "posts/:postId",
                element: <Post />,
                loader: postLoader,
            },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <TooltipProvider delayDuration={0}>
            <RouterProvider router={router} />
        </TooltipProvider>
    </React.StrictMode>,
);
