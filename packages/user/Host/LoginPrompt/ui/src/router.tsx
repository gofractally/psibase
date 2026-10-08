import { createBrowserRouter } from "react-router-dom";

import ErrorBoundary from "./components/error-boundary";
import { ConnectPrompt } from "./connect-prompt";
import { CreatePrompt } from "./create-prompt";
import { ImportPrompt } from "./import-prompt";
import Root from "./root";

const Router = createBrowserRouter([
    {
        path: "/",
        element: <Root />,
        errorElement: <ErrorBoundary />,
        children: [
            {
                path: "/",
                element: <ConnectPrompt />,
            },
            {
                path: "/import",
                element: <ImportPrompt />,
            },
            {
                path: "/plugin/web/prompt/connect",
                element: <ConnectPrompt isPrompt />,
            },
            {
                path: "/plugin/web/prompt/import",
                element: <ImportPrompt isPrompt />,
            },
            {
                path: "/plugin/web/prompt/create",
                element: <CreatePrompt />,
            },
        ],
    },
]);

export default Router;
