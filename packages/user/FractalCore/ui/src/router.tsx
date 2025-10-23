import { createBrowserRouter } from "react-router-dom";

import { ActiveAndUpcoming } from "@/pages/fractal/evaluations/active-and-upcoming";
import { Completed } from "@/pages/fractal/evaluations/completed";
import { AllMembers } from "@/pages/fractal/membership/all-members";
import { MyMembership } from "@/pages/fractal/membership/my-membership";

import { Layout } from "@/components/layout";
import { ProtectedRoute } from "@/components/protected-route";

import { EvaluationDeliberation } from "./pages/fractal/evaluations/evaluation-deliberation";
import { EvaluationResult } from "./pages/fractal/evaluations/evaluation-result";
import { AllGuildMembers } from "./pages/fractal/guild-membership/all-guild-members";
import { MyGuildMembership } from "./pages/fractal/guild-membership/my-guild-membership";
import { Guilds } from "./pages/fractal/guilds";
import { ApplicationDetail } from "./pages/fractal/membership/application-detail";
import { Applications } from "./pages/fractal/membership/applications";
import { Settings } from "./pages/settings";

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
                path: "/members",
                element: (
                    <ProtectedRoute>
                        <AllMembers />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/guilds",
                element: (
                    <ProtectedRoute>
                        <Guilds />
                    </ProtectedRoute>
                ),
            },

            {
                path: "/guild/:guildAccount",
                children: [
                    {
                        path: "",
                        element: (
                            <ProtectedRoute>
                                <MyGuildMembership />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "members",
                        element: (
                            <ProtectedRoute>
                                <AllGuildMembers />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "evaluations",
                        element: (
                            <ProtectedRoute>
                                <ActiveAndUpcoming />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "applications",
                        element: (
                            <ProtectedRoute>
                                <Applications />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "applications/:applicant",
                        element: (
                            <ProtectedRoute>
                                <ApplicationDetail />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "evaluations/completed",
                        element: (
                            <ProtectedRoute>
                                <Completed />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "evaluations/completed/:evaluationId",
                        element: (
                            <ProtectedRoute>
                                <EvaluationResult />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "evaluations/group/:groupNumber",
                        element: (
                            <ProtectedRoute>
                                <EvaluationDeliberation />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "settings",
                        element: (
                            <ProtectedRoute>
                                <Settings />
                            </ProtectedRoute>
                        ),
                    },
                ],
            },
        ],
    },
]);
