import { createBrowserRouter } from "react-router-dom";

import { Layout } from "@/components/layout";

import { App } from "./App";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [{ index: true, element: <App /> }],
    },
]);
