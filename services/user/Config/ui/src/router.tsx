import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/layout";
import { ProtectedRoute } from "./components/protected-route";
import { Loader } from "./pages/Loader";
import { BlockProduction } from "./pages/block-production";

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
            Block production
          </ProtectedRoute>
        ),
      },
      {
        path: "branding",
        element: (
          <ProtectedRoute>
              <BlockProduction />
          </ProtectedRoute>
        ),
      },
      {
        path: "pending-transactions",
        element: (
          <ProtectedRoute>
            <div>Coming soon: Pending Requests Page</div>
          </ProtectedRoute>
        ),
      },
    ],
  },
]);
