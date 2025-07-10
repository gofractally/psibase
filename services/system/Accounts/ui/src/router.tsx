import { createBrowserRouter } from "react-router-dom";

import { AccountSelection } from "./AccountSelection";
import KeyImport from "./KeyImport";
import Root from "./Root";

const Router = createBrowserRouter([
    {
        path: "/",
        element: <Root />,
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
