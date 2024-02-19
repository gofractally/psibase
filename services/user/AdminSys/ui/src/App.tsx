import { useEffect, useState } from "react";

import { PsinodeConfig } from "./configuration/interfaces";
import { NavHeader } from "./components/nav-header";
import { StatusBanner } from "./components/status-banner";
import { BootPage } from "./boot-wizard/boot-page";
import { ConfigurationPage } from "./configuration/configuration-page";
import { usePollJson } from "./hooks";
import { LogsPage } from "./log/logs-page";
import { DashboardPage } from "./dashboard/dashboard-page";
import { PowerPage } from "./power-control/power-page";
import { PeersPage } from "./peers/peers-page";
import { Peer } from "./peers/interfaces";

import "./App.css";

const MENU_ITEMS = [
    "Dashboard",
    "Peers",
    "Logs",
    "Configuration",
    "Power",
    "Boot",
];

function App() {
    const [activeItem, setActiveItem] = useState("");

    useEffect(() => {
        if (!activeItem) {
            setActiveItem(getPageTab());
        }
        window.addEventListener("hashchange", () => {
            setActiveItem(getPageTab());
        });
        return () => window.removeEventListener("hashchange", () => {});
    }, []);

    const [peers, peersError, refetchPeers] = usePollJson<Peer[]>(
        "/native/admin/peers"
    );

    const [config, configError, refetchConfig] = usePollJson<PsinodeConfig>(
        "/native/admin/config"
    );
    const [status, statusError] = usePollJson<string[]>("/native/admin/status");

    let activeMenuItems = [
        "Dashboard",
        "Peers",
        "Logs",
        "Configuration",
        "Power",
    ];
    if (status && status.includes("needgenesis")) {
        activeMenuItems.push("Boot");
    }

    return (
        <>
            <NavHeader menuItems={activeMenuItems} activeItem={activeItem} />
            <StatusBanner
                status={status}
                statusError={statusError}
                peersError={peersError}
                configError={configError}
            />
            {activeItem === "Dashboard" ? (
                <DashboardPage />
            ) : activeItem === "Logs" ? (
                <LogsPage />
            ) : activeItem === "Peers" ? (
                <PeersPage
                    config={config}
                    peers={peers || []}
                    refetchConfig={refetchConfig}
                    refetchPeers={refetchPeers}
                />
            ) : activeItem === "Configuration" ? (
                <ConfigurationPage
                    config={config}
                    refetchConfig={refetchConfig}
                />
            ) : activeItem === "Power" ? (
                <PowerPage />
            ) : activeItem === "Boot" ? (
                <BootPage config={config} refetchConfig={refetchConfig} />
            ) : null}
        </>
    );
}

export default App;

const getPageTab = () => {
    const tab = window.location.hash.substring(1) || "Unknown";
    return MENU_ITEMS.includes(tab) ? tab : "Dashboard";
};
