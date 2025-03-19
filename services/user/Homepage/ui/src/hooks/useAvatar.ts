import { generateAvatar } from "@/lib/createIdenticon";
import { useChainId } from "@/hooks/useChainId";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { siblingUrl } from "@psibase/common-lib";
import { useProfile } from "./useProfile";

import { useCacheBust } from "./useCacheBust";

export const useAvatar = (
    user?: string | null | undefined,
    lookupProfile = true,
): string => {
    const { data: currentUser } = useCurrentUser();
    const focusedUser = user || currentUser;

    const { data: chainId } = useChainId();
    const { data: profile } = useProfile(focusedUser, lookupProfile);
    const { bustData, bustedUser } = useCacheBust();

    if (profile?.profile?.avatar && focusedUser) {
        const bustParam = bustedUser === focusedUser ? `?bust=${bustData}` : "";
        return siblingUrl(
            undefined,
            focusedUser,
            `/profile/avatar${bustParam}`,
            false,
        );
    }

    if (focusedUser && chainId) {
        return generateAvatar(chainId, focusedUser);
    }

    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='%23888888' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm-1-4h2v2h-2zm0-10h2v8h-2z'/%3E%3C/svg%3E";
};
