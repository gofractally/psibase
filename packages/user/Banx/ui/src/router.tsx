import { createBrowserRouter, Navigate } from "react-router-dom";

import { Layout } from "@/components/layout";
import { LoginGate } from "@/components/login-gate";
import { AssetsPage } from "@/pages/assets";
import { CashPage } from "@/pages/cash";
import { InvitePage } from "@/pages/invite";
import { InvitesPage } from "@/pages/invites";
import { HistoryPage } from "@/pages/history";
import { ObligationsPage } from "@/pages/obligations";
import { PathPayPage } from "@/pages/path-pay";
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
            { path: "history", element: withGate(<HistoryPage />) },
            { path: "payees", element: withGate(<PayeesPage />) },
            { path: "invites", element: withGate(<InvitesPage />) },
            { path: "invite", element: <InvitePage /> },
            { path: "path-pay", element: withGate(<PathPayPage />) },
            { path: "requests", element: withGate(<RequestsPage />) },
            { path: "cash", element: withGate(<CashPage />) },
            { path: "policies", element: withGate(<PoliciesPage />) },
            { path: "assets", element: withGate(<AssetsPage />) },
        ],
    },
]);
