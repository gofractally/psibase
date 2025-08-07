import { createBrowserRouter } from "react-router-dom";

import { AppExists } from "./components/app-exists";
import { Layout } from "./components/layout";
import { ProtectedRoute } from "./components/protected-route";
import { Loader } from "./pages/Loader";
import { Settings } from "./pages/Settings";
import { Support } from "./pages/Support";
import { Thread } from "./pages/Support/Thread";
import { Upload } from "./pages/Upload";

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
