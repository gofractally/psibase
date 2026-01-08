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
import { SetupPage } from "./pages/setup-page";
import { PeersPage } from "./peers/peers-page";

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
                        <Route path="dashboard" element={<DashboardPage />} />
                        <Route
                            path="configuration"
                            element={<ConfigurationPage />}
                        />
                        <Route path="peers" element={<PeersPage />} />
                        <Route path="logs" element={<LogsPage />} />
                        <Route path="keys-and-devices" element={<KeysPage />} />
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
