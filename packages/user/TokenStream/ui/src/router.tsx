import { createBrowserRouter } from "react-router-dom";

import { Home } from "./pages/home";
import { Stream } from "./pages/stream";
import { Layout } from "./layout";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            { element: <Home />, path: '' }
        ]

    },
    {
        path: "/stream",
        element: <Layout />,
        children: [
            {
                path: ':id',
                element: <Stream />
            }
        ]
    },
]);
