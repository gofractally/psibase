import { createBrowserRouter } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import { Invite } from "./pages/Invite";
import { Root } from "./layout";

export default createBrowserRouter([
    {
        path: "/",
        element: <Root />,
        children: [
            {
                path: "/",
                element: <Dashboard />,
            },
            {
                path: "invite",
                element: <Invite />,
            },
        ],
    },
]);
