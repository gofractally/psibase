import { queryClient } from "@/main"
import { getSupervisor } from "@psibase/common-lib"
import { useMutation } from "@tanstack/react-query"



export const useRegister = () => {

    return useMutation({
        mutationFn: async (id: number) => {
            void await getSupervisor().functionCall({
                method: 'register',
                service: 'evaluations',
                intf: 'api',
                params: [id],
            })

            queryClient.setQueryData(['users', id], (data: unknown) => {
                console.log(data, 'needs to be updated');

            })
        }
    })
}