import { useInitialize } from "./hooks/useInitialize";
import "./styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DrawerLayout } from "components/layouts";
import { NavLinkItemProps } from "components/navigation/nav-link-item";
import { config } from "config";
import LogRocket from "logrocket";
import { Account, Home, Meeting } from "pages";
import { CreateFractal } from "pages/create-fractal/create-fractal";
import { Home as FractalHome, Invite, Join, Members } from "pages/fractal";
import { FractalSidebar } from "pages/fractal/fractal-sidebar";
import { HomeSidebar } from "pages/home/home-sidebar";
import { MeetingSelection } from "pages/meeting/meeting-selection";
import React from "react";
import ReactDOM from "react-dom";
import Modal from "react-modal";
import {
  Navigate,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  redirect,
} from "react-router-dom";
import { fractalApplet } from "service";
import { StateProvider } from "store";
import { v4 as uuid } from "uuid";

if (config.isProduction && !config.isSsr) {
  LogRocket.init("fractally/fractally");
}

Modal.setAppElement("#root");

export const queryClient = new QueryClient();

const randomMeeting = `/meeting/${uuid().split("-")[0]}-${Date.now()}`;

const menuItems: NavLinkItemProps[] = [
  { iconType: "home", to: `home`, children: "Home" },
  { iconType: "user-hex", to: "members", children: "Members" },
  { iconType: "signup", to: "meeting", children: "Meeting" },
];

export const useParam = (key: string) => {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
};

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<DrawerLayout />}>
      <Route path="/" element={<HomeSidebar />}>
        <Route path="home" element={<Home />} />
        <Route path="meetings" element={<MeetingSelection />} />
      </Route>
      <Route
        path="/accept"
        loader={async(params) => {
          const token = new URL(params.request.url).searchParams.get('token');
          console.log(token, 'is the token we should go for...');
          return redirect('/fractal/1');
        }}
      />
      <Route
        path="/fractal/:fractalID/*"
        element={<FractalSidebar menuItems={menuItems} />}
      >
        <Route path="home" element={<FractalHome />} />
        <Route path="members">
          <Route index element={<Members />} />
          <Route path="invite" element={<Invite />} />
        </Route>
        <Route path="join" element={<Join />} />
        <Route path="meeting" element={<Meeting />} />
      </Route>
      <Route path="/create" element={<FractalSidebar menuItems={[]} />}>
        <Route index element={<CreateFractal />} />
      </Route>
      <Route path="/account" element={<Account />} />
      <Route path="*" element={<Navigate to={randomMeeting} replace />} />
    </Route>
  )
);

// TODO: 404 No-Match Route (https://reactrouter.com/docs/en/v6/getting-started/tutorial#adding-a-no-match-route)
const App = () => {
  useInitialize(fractalApplet);

  return (
    <StateProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {/* <AccountMenu />
            <CreateNewAddressModal />
            <SignupModal /> */}
      </QueryClientProvider>
    </StateProvider>
  );
};

const container = document.getElementById("root");

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  container!
);
