import { Route, Routes } from "react-router-dom";
import App from "./App";

import { LogsPage } from "./log/logs-page";

import { DashboardPage } from "./pages/dashboard-page";
import { SetupPage } from "./pages/setup-page";
import { PeersPage } from "./peers/peers-page";
import { ConfigurationPage } from "./configuration/configuration-page";
import { BootPage } from "./boot-wizard/boot-page";
import { JoinPage } from "./pages/join-page";
import { CreatePage } from "./pages/create-page";

import { useNavigate } from "react-router-dom";
import { useStatuses } from "./hooks/useStatuses";
import { useEffect } from "react";

export const Routing = () => {
    const { data: status } = useStatuses();
    const navigate = useNavigate();
    // const location = useLocation();

    const isBootable = status && status.includes("needgenesis");

    useEffect(() => {
        console.log("isBootable", isBootable);
        if (isBootable) {
            navigate("/setup/");
        }
    }, [isBootable]);

    return (
        <Routes>
            <Route path="setup">
                <Route path="" element={<SetupPage />} />
                <Route path="join" element={<JoinPage />} />
                <Route path="create" element={<CreatePage />} />
            </Route>

            <Route path="" element={<App />}>
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="configuration" element={<ConfigurationPage />} />
                <Route path="peers" element={<PeersPage />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="boot" element={<BootPage />} />
            </Route>
        </Routes>
    );
};
