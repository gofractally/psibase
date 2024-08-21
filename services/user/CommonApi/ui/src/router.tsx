import { createBrowserRouter } from "react-router-dom";

import App from "./App";

const Page = () => <div className="bg-red-500">hello world</div>;

export default createBrowserRouter([
    {
        children: [
            {
                path: "/",
                element: <App />,
            },
            {
                path: "team",

                element: <Page />,
            },
        ],
    },
]);
