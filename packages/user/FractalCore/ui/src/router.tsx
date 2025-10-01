import { createBrowserRouter } from "react-router-dom";

import { ActiveAndUpcoming } from "@/pages/fractal/evaluations/active-and-upcoming";
import { Completed } from "@/pages/fractal/evaluations/completed";
import { AllMembers } from "@/pages/fractal/membership/all-members";
import { MyMembership } from "@/pages/fractal/membership/my-membership";

import { Layout } from "@/components/layout";
import { ProtectedRoute } from "@/components/protected-route";

import { EvaluationDeliberation } from "./pages/fractal/evaluations/evaluation-deliberation";
import { EvaluationResult } from "./pages/fractal/evaluations/evaluation-result";
import { Guild } from "./pages/fractal/guild";

export const router = createBrowserRouter([

    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "/",
                element: (
                    <ProtectedRoute>
                        <MyMembership />
                    </ProtectedRoute>
                ),
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
                path: "/guild/:guildSlug",
                element: (
                    <ProtectedRoute>
                        <Guild />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/membership/members",
                element: (
                    <ProtectedRoute>
                        <AllMembers />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/evaluations",
                element: (
                    <ProtectedRoute>
                        <ActiveAndUpcoming />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/evaluations/completed",
                element: (
                    <ProtectedRoute>
                        <Completed />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/evaluations/completed/:evaluationId",
                element: (
                    <ProtectedRoute>
                        <EvaluationResult />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/evaluations/:evaluationId/group/:groupNumber",
                element: (
                    <ProtectedRoute>
                        <EvaluationDeliberation />
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
