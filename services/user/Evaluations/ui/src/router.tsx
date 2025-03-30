import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { EvaluationPage } from "./pages/Evaluation";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <App />,
    },
    {
        path: ":id",
        element: <EvaluationPage />,
    },
]);
