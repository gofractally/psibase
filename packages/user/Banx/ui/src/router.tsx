import { createBrowserRouter, Navigate } from "react-router-dom";

import { Layout } from "@/components/layout";
import { LoginGate } from "@/components/login-gate";
import { AssetsPage } from "@/pages/assets";
import { ObligationsPage } from "@/pages/obligations";
import { PathPayPage } from "@/pages/path-pay";
import { PoliciesPage } from "@/pages/policies";

function withGate(page: React.ReactNode) {
    return <LoginGate>{page}</LoginGate>;
}

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            { index: true, element: <Navigate to="/obligations" replace /> },
            { path: "obligations", element: withGate(<ObligationsPage />) },
            { path: "path-pay", element: withGate(<PathPayPage />) },
            { path: "policies", element: withGate(<PoliciesPage />) },
            { path: "assets", element: withGate(<AssetsPage />) },
        ],
    },
]);
