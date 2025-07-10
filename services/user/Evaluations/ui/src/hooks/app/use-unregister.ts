import { queryClient } from "@/main";
import { zUser } from "@/lib/graphql/getUsers";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "../use-current-user";

export const useUnregister = () => {
    const { data: currentUser } = useCurrentUser();
    return useMutation({
        mutationFn: async (id: number) => {
            if (!currentUser) {
                throw new Error("User not found");
            }

            void (await getSupervisor().functionCall({
                method: "unregister",
                service: "evaluations",
                intf: "user",
                params: [id],
            }));

            queryClient.setQueryData(["users", id], (data: unknown) =>
                zUser
                    .array()
                    .parse(data)
                    .filter((user) => user.user !== currentUser),
            );
        },
    });
};
