import { createBrowserRouter, defer, redirect } from "react-router-dom";
import {
  queryFn as getCurrentAccount,
  GetCurrentUserRes,
  queryKey,
} from "./hooks/useCurrentUser";
import { queryClient } from "./queryClient";
import { Loader } from "./components/Loader";
import { z } from "zod";
import { Workshop } from "./components/Workshop";
import { Layout } from "./components/layout";

// Remember: Anyone can browse to any app regardless if they actually are allowed to authorise it or not.

const checkState = async () => {
  const cachedData = z
    .string()
    .or(z.undefined())
    .or(z.null())
    .parse(queryClient.getQueryData(queryKey));

  const isAlreadyLoggedIn = !!cachedData;

  if (isAlreadyLoggedIn) {
    return null;
  }

  return defer({
    userStatus: queryClient
      .prefetchQuery({
        queryKey,
        queryFn: getCurrentAccount,
      })
      .then(() => {
        const currentUser: GetCurrentUserRes | undefined =
          queryClient.getQueryData(queryKey);

        return currentUser || redirect("/");
      }),
  });
};

console.log({ checkState });

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Loader />,
  },
  {
    path: "/welcome",
    element: <div>You should login now..</div>,
  },
  {
    path: "/app",
    element: <Layout />,
    loader: checkState,
    children: [
      {
        path: "derp",
        element: <Workshop />,
      },
    ],
  },
]);
