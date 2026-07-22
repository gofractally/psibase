import { createBrowserRouter } from "react-router-dom";

import { Layout } from "@/components/layout";

import { App } from "./app";
import { EvaluationPage } from "./pages/evaluation";
import { GroupPage } from "./pages/group";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "/",
                element: <App />,
            },
            {
                path: ":owner/:id",
                element: <EvaluationPage />,
            },
            {
                path: ":owner/:id/:groupNumber",
                element: <GroupPage />,
            },
        ],
    },
]);
