import { useMutation, useQueryClient } from "@tanstack/react-query";

import { upsertUserToCache } from "@shared/hooks/use-contacts";
import SharedQueryKey from "@shared/lib/query-keys";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

function alreadyExists(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return msg.toLowerCase().includes("already exists");
}

export function useSaveContact(returnPath: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (p: { account: string; nickname: string }) => {
            const nickname = p.nickname.trim();
            if (!nickname) return false;
            const account = zAccount.parse(p.account);
            try {
                await supervisor.functionCall(
                    {
                        service: zAccount.parse("profiles"),
                        method: "set",
                        intf: "contacts",
                        params: [
                            {
                                account,
                                nickname,
                            },
                            false,
                        ],
                    },
                    { enabled: true, returnPath },
                );
            } catch (e) {
                if (alreadyExists(e)) return false;
                throw e;
            }
            return true;
        },
        onSuccess: (created, p) => {
            if (!created) return;
            const username = queryClient.getQueryData(
                SharedQueryKey.currentUser(),
            );
            if (typeof username === "string") {
                upsertUserToCache(username, {
                    account: p.account,
                    nickname: p.nickname.trim(),
                });
            }
            void queryClient.invalidateQueries({
                queryKey: SharedQueryKey.contacts(
                    typeof username === "string" ? username : undefined,
                ),
            });
            toast.success(`Added ${p.nickname.trim()} to contacts`);
        },
        onError: (e: Error) => toast.error(e.message),
    });
}
