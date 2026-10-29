import { Navigate, createBrowserRouter } from "react-router-dom";

import { getAppPath } from "./app-config";
import { configuredApps } from "./configured-apps";
import { Layout } from "./layout";
import Dashboard from "./pages/dashboard";
import { Invite } from "./pages/invite";
import { InviteResponse } from "./pages/invite-response";

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
                path: getAppPath(app),
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
            {
                path: "settings",
                element: <Navigate to="/?account=profile" replace />,
            },
        ],
    },
]);
