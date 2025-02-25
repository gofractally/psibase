import { createBrowserRouter } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import { Invite } from "./pages/Invite";
import { Layout } from "./layout";
import { InviteResponse } from "./pages/InviteResponse";
import { TokensPage } from "./apps/tokens/page";

export default createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "/",
                element: <Dashboard />,
            },
            {
                path: "tokens",
                element: <TokensPage />,
            },
            {
                path: "invite",
                element: <Invite />,
            },
            {
                path: "invite-response",
                element: <InviteResponse />,
            },
        ],
    },
]);
