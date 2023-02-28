import { useQuery } from "@tanstack/react-query";

import { fetchAvailableUsers, fetchUser } from "store/queries/fetchUser";

export const useUser = () => useQuery(["currentUser"], fetchUser);
export const useUsers = () =>
  useQuery(["users"], fetchAvailableUsers, { placeholderData: [] });
