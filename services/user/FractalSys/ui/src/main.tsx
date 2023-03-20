import React from "react";
import ReactDOM from "react-dom";
import {
    Navigate,
    Route,
    RouterProvider,
    createBrowserRouter,
    createRoutesFromElements,
} from "react-router-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LogRocket from "logrocket";
import Modal from "react-modal";
import { v4 as uuid } from "uuid";

import { DrawerLayout } from "components/layouts";
import { config } from "config";
import { Account, CreateFractal, Home, Meeting } from "pages";
import { Home as FractalHome, Invite, Join, Members } from "pages/fractal";
import { FractalSidebar } from "pages/fractal/fractal-sidebar";
import { HomeSidebar } from "pages/home/home-sidebar";
import { MeetingSelection } from "pages/meeting/meeting-selection";
import { StateProvider } from "store";

import "./styles/globals.css";

if (config.isProduction && !config.isSsr) {
    LogRocket.init("fractally/fractally");
}

Modal.setAppElement("#root");

export const queryClient = new QueryClient();

const randomMeeting = `/meeting/${uuid().split("-")[0]}-${Date.now()}`;

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route path="/" element={<DrawerLayout />}>
            <Route path="/" element={<HomeSidebar />}>
                <Route path="home" element={<Home />} />
                <Route path="meetings" element={<MeetingSelection />} />
                <Route path="new-fractal" element={<CreateFractal />} />
            </Route>
            <Route path="/fractal/:fractalID/*" element={<FractalSidebar />}>
                <Route path="home" element={<FractalHome />} />
                <Route path="members">
                    <Route index element={<Members />} />
                    <Route path="invite" element={<Invite />} />
                </Route>
                <Route path="join" element={<Join />} />
                <Route path="meeting" element={<Meeting />} />
            </Route>
            <Route path="/create" element={<CreateFractal />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to={randomMeeting} replace />} />
        </Route>
    )
);

// TODO: 404 No-Match Route (https://reactrouter.com/docs/en/v6/getting-started/tutorial#adding-a-no-match-route)
const App = () => (
    <StateProvider>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
            {/* <AccountMenu />
            <CreateNewAddressModal />
            <SignupModal /> */}
        </QueryClientProvider>
    </StateProvider>
);

const container = document.getElementById("root");

ReactDOM.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
    container!
);
