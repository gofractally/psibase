import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryProducers } from "@/hooks/use-producers";

import { getAccount } from "@shared/lib/get-account";
import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

const MAX_DELEGATION_DEPTH = 8;

export type TokenOwnerAccess =
    | { kind: "owner" }
    | { kind: "proposal"; proposeAs: string }
    | { kind: "none" };

const getDelegateOwner = async (account: string) =>
    z
        .string()
        .optional()
        .parse(
            await supervisor.functionCall({
                service: "auth-delg",
                plugin: "plugin",
                intf: "queries",
                method: "getOwner",
                params: [account],
            }),
        );

const isProducer = async (user: string) => {
    try {
        const producers = await queryClient.fetchQuery(queryProducers());
        return producers.some((producer) => producer.name === user);
    } catch {
        return false;
    }
};

// Follows auth-delegate ownership from `account` until it reaches `user` or an
// account authorized by the producers, which a producer can propose for.
const canProposeFor = async (
    user: string,
    account: string,
    depth = 0,
): Promise<boolean> => {
    if (account === user) return true;
    if (depth >= MAX_DELEGATION_DEPTH) return false;

    const info = await getAccount(account);
    switch (info?.authService) {
        case "auth-delg": {
            const owner = await getDelegateOwner(account);
            return !!owner && canProposeFor(user, owner, depth + 1);
        }
        case "producers":
            return isProducer(user);
        default:
            return false;
    }
};

/** Whether `user` can act as the token `owner`: directly, by proposing on its behalf, or not at all */
export const useTokenOwnerAccess = (
    owner: string | null | undefined,
    user: string | null | undefined,
) =>
    useQuery<TokenOwnerAccess>({
        queryKey: ["tokenOwnerAccess", owner, user],
        enabled: !!owner && !!user,
        queryFn: async () => {
            if (!owner || !user) return { kind: "none" };
            if (owner === user) return { kind: "owner" };
            return (await canProposeFor(user, owner))
                ? { kind: "proposal", proposeAs: owner }
                : { kind: "none" };
        },
    });
