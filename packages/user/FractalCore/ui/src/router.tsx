import { createBrowserRouter } from "react-router-dom";

import { Members } from "@/pages/fractal/members";
import { ActiveAndUpcoming } from "@/pages/guilds/evaluations/active-and-upcoming";
import { Completed } from "@/pages/guilds/evaluations/completed";

import { Layout } from "@/components/layout";

import { ProtectedRoute } from "@shared/components/protected-route";

import { Judicial } from "./pages/fractal/governance/judicial";
import { Legislative } from "./pages/fractal/governance/legislative";
import { Guilds } from "./pages/fractal/guilds/index";
import { Overview } from "./pages/fractal/overview/index";
import { ApplicationDetail } from "./pages/guilds/application-detail";
import { EvaluationDeliberation } from "./pages/guilds/evaluations/evaluation-deliberation";
import { EvaluationResult } from "./pages/guilds/evaluations/evaluation-result";
import { Leadership } from "./pages/guilds/leadership";
import { GuildMembershipLayout } from "./pages/guilds/membership/_layout";
import { GuildApplicants } from "./pages/guilds/membership/applicants";
import { GuildMembers } from "./pages/guilds/membership/members";
import { GuildOverview } from "./pages/guilds/overview";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "/",
                element: (
                    <ProtectedRoute>
                        <Overview />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/legislative",
                element: (
                    <ProtectedRoute>
                        <Legislative />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/judicial",
                element: (
                    <ProtectedRoute>
                        <Judicial />
                    </ProtectedRoute>
                ),
            },
            {
                path: "/members",
                element: (
                    <ProtectedRoute>
                        <Members />
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
                                <GuildOverview />
                            </ProtectedRoute>
                        ),
                    },
                    {
                        path: "membership",
                        element: (
                            <ProtectedRoute>
                                <GuildMembershipLayout />
                            </ProtectedRoute>
                        ),
                        children: [
                            {
                                path: "members",
                                element: <GuildMembers />,
                            },
                            {
                                path: "applicants",
                                element: <GuildApplicants />,
                            },
                        ],
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
                        path: "leadership",
                        element: (
                            <ProtectedRoute>
                                <Leadership />
                            </ProtectedRoute>
                        ),
                    },
                ],
            },
        ],
    },
]);
