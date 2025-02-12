import { supervisor } from "@/supervisor";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useAutoNavigate } from "./useAutoNav";

export const useLogout = () => {
  const queryClient = useQueryClient();
  const [_, setAutoNav] = useAutoNavigate();

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
      setAutoNav(false);
      queryClient.setQueryData(["loggedInUser"], null);
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
      }, 2500);
    },
  });
};
