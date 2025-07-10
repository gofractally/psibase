import { supervisor } from "@/supervisor";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["logout"],
    mutationFn: async () =>
      supervisor.functionCall({
        method: "logout",
        params: [],
        service: "accounts",
        intf: "activeApp",
      }),
    onSuccess: () => {
      queryClient.setQueryData(["loggedInUser"], null);

    },
  });
};
