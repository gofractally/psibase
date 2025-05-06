import { Loader } from "@/pages/Loader";
import { ActiveAndUpcoming } from "@/pages/evaluations/active-and-upcoming";
import { Completed } from "@/pages/evaluations/completed";
import { Proposed } from "@/pages/evaluations/proposed";
import { AllMembers } from "@/pages/membership/all-members";
import { MyMembership } from "@/pages/membership/my-membership";
import { createBrowserRouter, redirect } from "react-router-dom";

import { AppExists } from "@/components/app-exists";
import { Layout } from "@/components/layout";
import { ProtectedRoute } from "@/components/protected-route";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Loader />,
    },
    {
        path: "/fractal",
        element: <Layout />,
        children: [
            {
                path: ":fractalName",
                index: true,
                loader: () => redirect("evaluations"),
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
            {
                path: ":fractalName/evaluations",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <ActiveAndUpcoming />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations/proposed",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Proposed />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations/completed",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Completed />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
