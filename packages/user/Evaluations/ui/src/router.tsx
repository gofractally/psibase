import { createBrowserRouter } from "react-router-dom";

import { Layout } from "@/components/layout";

import { App } from "./App";
import { EvaluationPage } from "./pages/Evaluation";
import { GroupPage } from "./pages/Group";

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
