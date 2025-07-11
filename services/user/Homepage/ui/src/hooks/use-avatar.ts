import { useEffect, useState } from "react";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentUser } from "@/hooks/use-current-user";
import { generateAvatar } from "@/lib/createIdenticon";

import { useCacheBust } from "./use-cache-bust";

const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='%23888888' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm-1-4h2v2h-2zm0-10h2v8h-2z'/%3E%3C/svg%3E";

const generateAvatarUrl = (username: string): string =>
    siblingUrl(undefined, username, `/profile/avatar`, false);

const checkImageExists = (
    url: string,
    forceNoCache: boolean = false,
): Promise<boolean> =>
    new Promise((resolve) => {
        if (!url) {
            resolve(false);
            return;
        }

        const img = new Image();
        img.src = url + (forceNoCache ? `?bust=${Date.now()}` : "");
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
    });

const Type = z.enum(["default", "generated", "uploaded"]);

const AvatarState = z.object({
    avatarSrc: z.string(),
    type: Type,
});

export const useAvatar = (user?: string | null | undefined) => {
    const { data: currentUser } = useCurrentUser();
    const focusedUser = user || currentUser;

    const { data: chainId } = useChainId();
    const { bustData, bustedUser } = useCacheBust();

    const [avatarState, setAvatarState] = useState<z.infer<typeof AvatarState>>(
        {
            avatarSrc: defaultAvatar,
            type: "default",
        },
    );

    const loadAvatar = async (forceNoCache: boolean = false) => {
        if (!focusedUser) {
            setAvatarState({
                avatarSrc: defaultAvatar,
                type: "default",
            });
            return;
        }

        const bustParam = bustedUser === focusedUser ? `?bust=${bustData}` : "";
        const initialUrl = generateAvatarUrl(focusedUser) + bustParam;

        const isImageExists = await checkImageExists(initialUrl, forceNoCache);

        if (isImageExists) {
            setAvatarState({
                type: "uploaded",
                avatarSrc: initialUrl,
            });
        } else if (chainId) {
            setAvatarState({
                type: "generated",
                avatarSrc: generateAvatar(chainId, focusedUser),
            });
        } else {
            setAvatarState({
                type: "default",
                avatarSrc: defaultAvatar,
            });
        }
    };

    const forceRefresh = async () => {
        await loadAvatar(); // Re-run the avatar check logic
    };

    useEffect(() => {
        loadAvatar();
    }, [focusedUser, chainId, bustData, bustedUser]);

    return { ...avatarState, forceRefresh };
};
