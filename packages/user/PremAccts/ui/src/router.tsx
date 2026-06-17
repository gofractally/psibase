import { createBrowserRouter } from "react-router-dom";

import { Layout } from "@/components/layout";
import { PremAccountsMain } from "@/components/prem-accounts-main";

import { ProtectedRoute } from "@shared/components/protected-route";

import { BuyPage } from "./pages/buy-page";
import { PurchasedPage } from "./pages/purchased-page";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                element: (
                    <ProtectedRoute>
                        <PremAccountsMain />
                    </ProtectedRoute>
                ),
                children: [
                    { index: true, element: <BuyPage /> },
                    { path: "purchased", element: <PurchasedPage /> },
                ],
            },
        ],
    },
]);
