import { createBrowserRouter } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import { Invite } from "./pages/Invite";
import { Layout } from "./layout";
import { InviteResponse } from "./pages/InviteResponse";
import { ChainmailPage } from "./apps/chainmail/page";
import { WorkshopPage } from "./apps/workshop/page";
import { configuredApps } from "./configuredApps";


export default createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "/",
                element: <Dashboard />,
            },
            ...configuredApps.map(app => ({
                path: app.service,
                element: app.element,
                children: app.children.map(child => ({
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
