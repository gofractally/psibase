import { useEffect, useState } from "react";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { generateAvatar } from "@shared/lib/create-identicon";

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

export const AvatarState = z.object({
    avatarSrc: z.string(),
    type: Type,
});

export const useAvatar = (
    user: string | null | undefined,
    chainId: string = "2282d80c-1c8c-43b9-808d-13e3e8d580c7",
) => {
    const { bustData, bustedUser } = useCacheBust();

    const [avatarState, setAvatarState] = useState<z.infer<typeof AvatarState>>(
        {
            avatarSrc: defaultAvatar,
            type: "default",
        },
    );

    const loadAvatar = async (forceNoCache: boolean = false) => {
        if (!user) {
            setAvatarState({
                avatarSrc: defaultAvatar,
                type: "default",
            });
            return;
        }

        const bustParam = bustedUser === user ? `?bust=${bustData}` : "";
        const initialUrl = generateAvatarUrl(user) + bustParam;

        const isImageExists = await checkImageExists(initialUrl, forceNoCache);

        if (isImageExists) {
            setAvatarState({
                type: "uploaded",
                avatarSrc: initialUrl,
            });
        } else if (chainId) {
            setAvatarState({
                type: "generated",
                avatarSrc: generateAvatar(chainId, user),
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
    }, [user, chainId, bustData, bustedUser]);

    return { ...avatarState, forceRefresh };
};
