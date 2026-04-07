import { createBrowserRouter } from "react-router-dom";

import { configuredApps } from "./configured-apps";
import { Layout } from "./layout";
import Dashboard from "./pages/dashboard";
import { Invite } from "./pages/invite";
import { InviteResponse } from "./pages/invite-response";
import { SettingsPage } from "./apps/settings/page";

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
            {
                path: "settings",
                element: <SettingsPage />,
            },
        ],
    },
]);
