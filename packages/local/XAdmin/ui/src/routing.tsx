import {
    FileText,
    Key,
    LayoutDashboard,
    Network,
    Package,
    Settings,
} from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";

import App from "./App";
import { ConfigurationPage } from "./configuration/configuration-page";
import { useStatuses } from "./hooks/useStatuses";
import { Layout } from "./layout";
import { LogsPage } from "./log/logs-page";
import { CreatePage } from "./pages/create-page";
import { DashboardPage } from "./pages/dashboard-page";
import { JoinPage } from "./pages/join-page";
import { KeysPage } from "./pages/keys-page";
import { NodeLocalPage } from "./pages/node-local-page";
import { SetupPage } from "./pages/setup-page";
import { PeersPage } from "./peers/peers-page";

export const routes = [
    {
        name: "Dashboard",
        icon: LayoutDashboard,
        path: "dashboard",
        element: <DashboardPage />,
    },
    {
        name: "Setup",
        icon: Settings,
        path: "configuration",
        element: <ConfigurationPage />,
    },
    {
        name: "Peers",
        icon: Network,
        path: "peers",
        element: <PeersPage />,
    },
    {
        name: "Logs",
        icon: FileText,
        path: "logs",
        element: <LogsPage />,
    },
    {
        name: "Packages",
        icon: Package,
        path: "packages",
        element: <NodeLocalPage />,
    },
    {
        name: "Keys & Devices",
        icon: Key,
        path: "keys-and-devices",
        element: <KeysPage />,
        secureOnly: true,
    },
];

export const Routing = () => {
    const { data: status, isLoading } = useStatuses();

    const isBootable = status && status.includes("needgenesis");

    if (isLoading) {
        return null;
    }

    return (
        <Routes>
            <Route path="setup">
                <Route path="" element={<SetupPage />} />
                <Route path="join" element={<JoinPage />} />
                <Route path="create" element={<CreatePage />} />
            </Route>

            {isBootable ? (
                <Route path="*" element={<Navigate to="/setup" replace />} />
            ) : (
                <Route path="" element={<Layout />}>
                    <Route path="" element={<App />}>
                        {routes.map((route) => (
                            <Route
                                key={route.path}
                                path={route.path}
                                element={route.element}
                            />
                        ))}
                        <Route
                            path=""
                            element={
                                <Navigate to="/dashboard" replace={true} />
                            }
                        />
                    </Route>
                </Route>
            )}
        </Routes>
    );
};
