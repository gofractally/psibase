import { createBrowserRouter, redirect } from "react-router-dom";

import { ActiveAndUpcoming } from "@/pages/fractal/evaluations/active-and-upcoming";
import { Completed } from "@/pages/fractal/evaluations/completed";
import { AllMembers } from "@/pages/fractal/membership/all-members";
import { MyMembership } from "@/pages/fractal/membership/my-membership";
import { Loader } from "@/pages/loader";

import { Layout } from "@/components/layout";
import { ProtectedRoute } from "@/components/protected-route";

import { EvaluationDeliberation } from "./pages/fractal/evaluations/evaluation-deliberation";
import { EvaluationResult } from "./pages/fractal/evaluations/evaluation-result";
import { Guild } from "./pages/fractal/guild";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Loader />,
    },
    {
        path: "/membership",
        element: (
            <ProtectedRoute>
                <MyMembership />
            </ProtectedRoute>
        ),
    },
    {
        path: ":fractalName/guild/:guildId",
        element: (
            <ProtectedRoute>
                <Guild />
            </ProtectedRoute>
        ),
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
                        <MyMembership />
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/guild/:guildId",
                element: (
                    <ProtectedRoute>
                        <Guild />
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/membership/members",
                element: (
                    <ProtectedRoute>
                        <AllMembers />
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations",
                element: (
                    <ProtectedRoute>
                        <ActiveAndUpcoming />
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations/completed",
                element: (
                    <ProtectedRoute>
                        <Completed />
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations/completed/:evaluationId",
                element: (
                    <ProtectedRoute>
                        <EvaluationResult />
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/evaluations/:evaluationId/group/:groupNumber",
                element: (
                    <ProtectedRoute>
                        <EvaluationDeliberation />
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
