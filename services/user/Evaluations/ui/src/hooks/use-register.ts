import { queryClient } from "@/main"
import { zUser } from "@lib/getUsers"
import { getSupervisor } from "@psibase/common-lib"
import { useMutation } from "@tanstack/react-query"
import { useCurrentUser } from "./use-current-user"



export const useRegister = () => {


    const { data: currentUser } = useCurrentUser();
    return useMutation({
        mutationFn: async (id: number) => {
            if (!currentUser) {
                throw new Error("User not found");
            }
            void await getSupervisor().functionCall({
                method: 'register',
                service: 'evaluations',
                intf: 'api',
                params: [id],
            })

            queryClient.setQueryData(['users', id], (data: unknown) => {
                console.log(data, 'needs to be updated');

                const users = zUser.array().parse(data);

                const newUser = zUser.parse({
                    user: currentUser,
                    groupNumber: null,
                    proposal: null,
                    submission: null,
                })

                return zUser.array().parse([...users, newUser]);


            })
        }
    })
}