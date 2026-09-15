import { createBrowserRouter, Navigate } from "react-router-dom";

import { Layout } from "@/components/layout";
import { LoginGate } from "@/components/login-gate";
import { AssetsPage } from "@/pages/assets";
import { CashPage } from "@/pages/cash";
import { InvitePage } from "@/pages/invite";
import { InvitesPage } from "@/pages/invites";
import { ObligationsPage } from "@/pages/obligations";
import { PayeesPage } from "@/pages/payees";
import { PoliciesPage } from "@/pages/policies";
import { RequestsPage } from "@/pages/requests";

function withGate(page: React.ReactNode) {
    return <LoginGate>{page}</LoginGate>;
}

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            { index: true, element: <Navigate to="/accounts" replace /> },
            { path: "accounts", element: withGate(<ObligationsPage />) },
            { path: "history", element: <Navigate to="/accounts" replace /> },
            { path: "payees", element: withGate(<PayeesPage />) },
            { path: "invites", element: withGate(<InvitesPage />) },
            { path: "invite", element: <InvitePage /> },
            { path: "requests", element: withGate(<RequestsPage />) },
            { path: "cash", element: withGate(<CashPage />) },
            { path: "policies", element: withGate(<PoliciesPage />) },
            { path: "assets", element: withGate(<AssetsPage />) },
        ],
    },
]);
