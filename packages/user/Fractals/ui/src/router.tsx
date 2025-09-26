import { createBrowserRouter, redirect } from "react-router-dom";

import { AllMembers } from "@/pages/fractal/membership/all-members";
import { MyMembership } from "@/pages/fractal/membership/my-membership";
import { Loader } from "@/pages/loader";

import { AppExists } from "@/components/app-exists";
import { Layout } from "@/components/layout";
import { ProtectedRoute } from "@/components/protected-route";

import { Browse } from "./pages/global/browse";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Loader />,
    },
    {
        path: "/browse",
        element: <Layout />,
        children: [
            {
                path: "",
                element: <Browse />,
            },
        ],
    },
    {
        path: "/fractal",
        element: <Layout />,
        children: [
            {
                path: ":fractalName",
                index: true,
                loader: () => redirect("membership"),
            },
            {
                path: ":fractalName/membership",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <MyMembership />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/membership/members",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <AllMembers />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
