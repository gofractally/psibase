import { supervisor } from "@/supervisor";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useExpectCurrentUser } from "./useExpectCurrentUser";
import QueryKey from "@/lib/queryKeys";

export const useLogout = () => {
  const queryClient = useQueryClient();
  const [_, setExpectCurrentUser] = useExpectCurrentUser();

  return useMutation({
    mutationKey: QueryKey.logout(),
    mutationFn: async () =>
      supervisor.functionCall({
        method: "logout",
        params: [],
        service: "accounts",
        intf: "activeApp",
      }),
    onSuccess: () => {
      setExpectCurrentUser(false);
      queryClient.setQueryData(QueryKey.currentUser(), null);
    },
  });
};
