import { createBrowserRouter } from "react-router-dom";

import { AccountSelection } from "./AccountSelection";
import KeyImport from "./KeyImport";
import Root from "./Root";
import ErrorBoundary from "./components/error-boundary";

const Router = createBrowserRouter([
    {
        path: "/",
        element: <Root />,
        errorElement: <ErrorBoundary />,
        children: [
            {
                path: "/",
                element: <AccountSelection />,
            },
            {
                path: "/key",
                element: <KeyImport />,
            },
        ],
    },
]);

export default Router;
