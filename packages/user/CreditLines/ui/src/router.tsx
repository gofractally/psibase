import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./components/protected-route";
import { App } from "./App";
import { Layout } from "./layout";


export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            {
                path: "/",
                element: (
                    <ProtectedRoute>
                        <App />
                    </ProtectedRoute>
                ),
            },



        ],
    },
]);
