import { createBrowserRouter } from "react-router-dom";

import { Layout } from "@/components/layout";
import { NameMarketMain } from "@/components/name-market-main";

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
                        <NameMarketMain />
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
