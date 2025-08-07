import { createBrowserRouter } from "react-router-dom";

import { Layout } from "./components/layout";
import { ProtectedRoute } from "./components/protected-route";
import { Loader } from "./pages/Loader";
import { BlockProduction } from "./pages/block-production";
import { Branding } from "./pages/branding";
import { Packages } from "./pages/packages";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Loader />,
    },
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "block-production",
                element: (
                    <ProtectedRoute>
                        <BlockProduction />
                    </ProtectedRoute>
                ),
            },
            {
                path: "branding",
                element: (
                    <ProtectedRoute>
                        <Branding />
                    </ProtectedRoute>
                ),
            },
            {
                path: "packages",
                element: (
                    <ProtectedRoute>
                        <Packages />
                    </ProtectedRoute>
                ),
            },
        ],
    },
]);
