import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { EvaluationPage } from "./pages/Evaluation";
import { Layout } from "@components/layout";
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
                path: ":id",
                element: <EvaluationPage />,
            },
            {
                path: ":id/:groupNumber",
                element: <GroupPage />,
            },
        ],
    },
]);
