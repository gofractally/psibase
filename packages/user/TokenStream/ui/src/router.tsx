import { createBrowserRouter } from "react-router-dom";

import { Layout } from "./layout";
import { Home } from "./pages/home";
import { Stream } from "./pages/stream";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [{ element: <Home />, path: "" }],
    },
    {
        path: "/stream",
        element: <Layout />,
        children: [
            {
                path: ":id",
                element: <Stream />,
            },
        ],
    },
]);
