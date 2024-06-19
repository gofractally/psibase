import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";
import { Route, Routes } from "react-router-dom";
import { HashRouter } from "react-router-dom";

import App from "./App";
import "./styles/globals.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LogsPage } from "./log/logs-page";

import { DashboardPage } from "./pages/dashboard-page";
import { PeersPage } from "./peers/peers-page";
import { ConfigurationPage } from "./configuration/configuration-page";
import { BootPage } from "./boot-wizard/boot-page";

export const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <HashRouter>
                <Routes>
                    <Route path="" element={<App />}>
                        <Route path="dashboard" element={<DashboardPage />} />
                        <Route
                            path="configuration"
                            element={<ConfigurationPage />}
                        />
                        <Route path="peers" element={<PeersPage />} />
                        <Route path="logs" element={<LogsPage />} />
                        <Route path="boot" element={<BootPage />} />
                    </Route>
                </Routes>
            </HashRouter>
        </ThemeProvider>
    </QueryClientProvider>
);
