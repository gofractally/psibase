import { createBrowserRouter } from "react-router-dom";
import { Workshop } from "./components/Workshop";
import { Layout } from "./components/layout";
import { ProtectedRoute } from "./components/protected-route";
import { Loader } from "./components/Loader";

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
            <Workshop />
          </ProtectedRoute>
        ),
      },
      {
        path: ":appName/support",
        element: (
          <ProtectedRoute>
            <div>Support Page</div>
          </ProtectedRoute>
        ),
      },
      {
        path: ":appName/pending-requests",
        element: (
          <ProtectedRoute>
            <div>Pending Requests Page</div>
          </ProtectedRoute>
        ),
      },
    ],
  },
]);
