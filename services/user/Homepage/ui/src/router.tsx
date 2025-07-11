import { createBrowserRouter } from "react-router-dom";

import { configuredApps } from "./configuredApps";
import { Layout } from "./layout";
import Dashboard from "./pages/Dashboard";
import { Invite } from "./pages/Invite";
import { InviteResponse } from "./pages/InviteResponse";

export default createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "/",
                element: <Dashboard />,
            },
            ...configuredApps.map((app) => ({
                path: app.service,
                element: app.element,
                children: app.children.map((child) => ({
                    path: child.path,
                    element: child.element,
                })),
            })),
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
