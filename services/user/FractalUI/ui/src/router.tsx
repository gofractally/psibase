import { createBrowserRouter } from "react-router-dom";

import { AppExists } from "./components/app-exists";
import { Layout } from "./components/layout";
import { ProtectedRoute } from "./components/protected-route";
import { Loader } from "./pages/Loader";
import { Settings } from "./pages/Settings";
import { Support } from "./pages/Support";
import { Upload } from "./pages/Upload";

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
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Settings />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/membership",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Upload />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":fractalName/membership/members",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Upload />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":appName/evaluations",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Support />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":appName/evaluations/proposed",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Support />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
            {
                path: ":appName/evaluations/completed",
                element: (
                    <ProtectedRoute>
                        <AppExists>
                            <Support />
                        </AppExists>
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
