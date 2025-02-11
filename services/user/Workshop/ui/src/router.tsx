import { createBrowserRouter, defer } from "react-router-dom";
import {
  queryFn as getCurrentAccount,
  GetCurrentUserRes,
  queryKey,
} from "./hooks/useCurrentUser";
import { queryClient } from "./queryClient";
import { z } from "zod";
import { Workshop } from "./components/Workshop";
import { Layout } from "./components/layout";
import { Loader } from "./components/Loader";
import { ProtectedRoute } from "./components/protected-route";

// Remember: Anyone can browse to any app regardless if they actually are allowed to authorise it or not.

// What this achieves
// For the root page ("/") Nothing.
// For other pages this is applied to
// it will render the layout component + page component, virtually instantly if cached
// if not, it will render the loading state of the layout + then a general loading spinner for the component
//
const authLoader = async () => {
  const cachedData = z
    .string()
    .or(z.undefined())
    .or(z.null())
    .parse(queryClient.getQueryData(queryKey));

  const isAlreadyLoggedIn = !!cachedData;

  if (isAlreadyLoggedIn) {
    return defer({ userStatus: (async () => cachedData)() });
  }

  return defer({
    userStatus: queryClient
      .prefetchQuery({
        queryKey,
        queryFn: getCurrentAccount,
        staleTime: 10000,
      })
      .then(() => {
        const currentUser: GetCurrentUserRes | undefined =
          queryClient.getQueryData(queryKey);

        return currentUser;
      }),
  });
};

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Loader />,
  },
  {
    path: "/login",
    element: <div>You should login now..</div>,
  },
  {
    path: "/app",
    element: <Layout />,
    loader: authLoader,
    children: [
      {
        path: ":appName",
        loader: authLoader,
        element: (
          <ProtectedRoute>
            <Workshop />
          </ProtectedRoute>
        ),
      },
    ],
  },
]);
