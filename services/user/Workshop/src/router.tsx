import { createBrowserRouter } from "react-router-dom";

import Root from "./Root";
import { Settings } from "./pages/Settings";

export const Router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      {
        path: "settings",
        element: <Settings />,
      },
    ],
  },
]);
