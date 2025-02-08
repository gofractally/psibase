import { supervisor } from "@/main";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

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
      toast("Logged out");
      queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
      }, 2500);
    },
  });
};
