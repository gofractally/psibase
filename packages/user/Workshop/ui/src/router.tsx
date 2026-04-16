import { createBrowserRouter } from "react-router-dom";

import { ProtectedRoute } from "@shared/components/protected-route";

import { AppExists } from "./components/app-exists";
import { Layout } from "./components/layout";
import { Loader } from "./pages/loader";
import { Settings } from "./pages/settings";
import { Support } from "./pages/support";
import { Thread } from "./pages/support/thread";
import { Upload } from "./pages/upload";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Loader />,
    },
    {
        path: "/app",
        element: <Layout />,
        children: [
            {
                path: ":appName",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Settings />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":appName/upload",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Upload />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":appName/support",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Support />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":appName/support/:threadId",
                element: (
                    <ProtectedRoute>
                        <Thread />
                    </ProtectedRoute>
                ),
            },
            {
                path: ":appName/pending-requests",
                element: (
                    <ProtectedRoute>
                        <div>Coming soon: Pending Requests Page</div>
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
