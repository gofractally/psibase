import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/layout";
import { ProtectedRoute } from "./components/protected-route";
import { Loader } from "./pages/Loader";
import { Settings } from "./pages/Settings";
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
            <Settings />
          </ProtectedRoute>
        ),
      },
      {
        path: ":appName/upload",
        element: (
          <ProtectedRoute>
            <Upload />
          </ProtectedRoute>
        ),
      },
      {
        path: ":appName/support",
        element: (
          <ProtectedRoute>
            <div>Coming soon: Support Page</div>
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
