import { createBrowserRouter, Navigate } from "react-router-dom";

import { AccountPage } from "@/pages/account";
import { BlockDetailPage } from "@/pages/block-detail";
import { BlocksPage } from "@/pages/blocks";
import { DashboardPage } from "@/pages/dashboard";
import { NetworkPage } from "@/pages/network";
import { NotFoundPage } from "@/pages/not-found";
import { ProvidersPage } from "@/pages/providers";
import { SearchPage } from "@/pages/search";
import { ServicesPage } from "@/pages/services";
import { TransactionDetailPage } from "@/pages/transaction-detail";
import { TransactionsPage } from "@/pages/transactions";

import { Layout } from "@/components/layout";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            { index: true, element: <DashboardPage /> },
            { path: "blocks", element: <BlocksPage /> },
            { path: "blocks/:blockNum", element: <BlockDetailPage /> },
            { path: "transactions", element: <TransactionsPage /> },
            { path: "tx/:id", element: <TransactionDetailPage /> },
            { path: "providers", element: <ProvidersPage /> },
            { path: "producers", element: <Navigate to="/providers" replace /> },
            { path: "services", element: <ServicesPage /> },
            { path: "network", element: <NetworkPage /> },
            { path: "accounts/:name", element: <AccountPage /> },
            { path: "search", element: <SearchPage /> },
            { path: "*", element: <NotFoundPage /> },
        ],
    },
]);
