import { useEffect, useState } from "react";

import { PsinodeConfig } from "./configuration/interfaces";
import { NavHeader } from "./components/nav-header";
import { StatusBanner } from "./components/status-banner";
import { ConfigurationPage } from "./configuration/configuration-page";
import { usePollJson } from "./hooks";
import { LogsPage } from "./log/logs-page";
import { DashboardPage } from "./pages/dashboard-page";
import { PeersPage } from "./peers/peers-page";
import { Peer } from "./peers/interfaces";

import "./App.css";

const MENU_ITEMS = ["Dashboard", "Peers", "Logs", "Configuration"];

function App() {
    const [activeItem, setActiveItem] = useState("");

    useEffect(() => {
        if (!activeItem) {
            setActiveItem(getPageTab());
        }
    }, []);

    const [peers, peersError, refetchPeers] = usePollJson<Peer[]>(
        "/native/admin/peers"
    );

    const [config, configError, refetchConfig] = usePollJson<PsinodeConfig>(
        "/native/admin/config"
    );

    const onTabClick = (tab: string) => {
        updatePageTab(tab);
        setActiveItem(tab);
    };

    return (
        <>
            <NavHeader
                menuItems={MENU_ITEMS}
                activeItem={activeItem}
                onClick={onTabClick}
            />
            <StatusBanner peersError={peersError} configError={configError} />
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
            ) : null}
        </>
    );
}

export default App;

const getPageTab = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "Dashboard";
};

const updatePageTab = (newTab: string) => {
    if (window.history.pushState) {
        const newURL = new URL(window.location.href);
        newURL.search = `?tab=${newTab}`;
        window.history.pushState({ path: newURL.href }, "", newURL.href);
    }
};
