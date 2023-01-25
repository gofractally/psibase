import { useQuery } from "@tanstack/react-query";

import { fetchUser } from "store/queries/fetchUser";

export const useUser = () => useQuery(["currentUser"], fetchUser);
