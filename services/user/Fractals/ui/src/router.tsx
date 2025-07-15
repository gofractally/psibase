import { createBrowserRouter, redirect } from "react-router-dom";

import { ActiveAndUpcoming } from "@/pages/fractal/evaluations/active-and-upcoming";
import { Completed } from "@/pages/fractal/evaluations/completed";
import { AllMembers } from "@/pages/fractal/membership/all-members";
import { MyMembership } from "@/pages/fractal/membership/my-membership";
import { Loader } from "@/pages/loader";

import { AppExists } from "@/components/app-exists";
import { Layout } from "@/components/layout";
import { ProtectedRoute } from "@/components/protected-route";

import { EvaluationDeliberation } from "./pages/fractal/evaluations/evaluation-deliberation";
import { EvaluationResult } from "./pages/fractal/evaluations/evaluation-result";
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
                loader: () => redirect("evaluations/"),
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
                path: ":fractalName/evaluations/completed",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Completed />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations/completed/:evaluationId",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <EvaluationResult />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations/:evaluationId/group/:groupNumber",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <EvaluationDeliberation />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
