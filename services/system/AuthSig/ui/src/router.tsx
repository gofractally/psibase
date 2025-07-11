import { createBrowserRouter } from "react-router-dom";

import { AccountSelection } from "./AccountSelection";
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
        ],
    },
]);

export default Router;
