import { createBrowserRouter } from "react-router-dom";

import { Layout } from "@/components/layout";
import { LoginGate } from "@/components/login-gate";
import { AssetsPage } from "@/pages/assets";
import { CreditLinesPage } from "@/pages/credit-lines";
import { Dashboard } from "@/pages/dashboard";
import { DepositPage } from "@/pages/deposit";
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
            { index: true, element: withGate(<Dashboard />) },
            { path: "credit-lines", element: withGate(<CreditLinesPage />) },
            { path: "obligations", element: withGate(<ObligationsPage />) },
            { path: "deposit", element: withGate(<DepositPage />) },
            { path: "path-pay", element: withGate(<PathPayPage />) },
            { path: "policies", element: withGate(<PoliciesPage />) },
            { path: "assets", element: withGate(<AssetsPage />) },
        ],
    },
]);
