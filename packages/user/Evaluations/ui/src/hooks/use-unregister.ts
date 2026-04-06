import { useMutation } from "@tanstack/react-query";

import { zUser } from "@/lib/graphql/getUsers";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

export const useUnregister = () => {
    const { data: currentUser } = useCurrentUser();
    return useMutation({
        mutationFn: async (id: number) => {
            if (!currentUser) {
                throw new Error("User not found");
            }

            void (await supervisor.functionCall({
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
