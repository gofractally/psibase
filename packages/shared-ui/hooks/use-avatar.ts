import { useEffect, useState } from "react";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { AvatarType, generateAvatar } from "@shared/lib/create-identicon";

import { useCacheBust } from "./use-cache-bust";
import { useChainId } from "./use-chain-id";

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

export const useAvatar = ({
    account,
    type = "identicon",
}: {
    account?: string | null;
    type?: AvatarType;
}) => {
    const [existingImageUrl, setExistingImageUrl] = useState<string | null>(
        null,
    );
    const [isCheckingImageExists, setIsCheckingImageExists] = useState(false);

    const { bustData, bustedUser } = useCacheBust();
    const { data: chainId, isPending: isPendingChainId } = useChainId({
        enabled: Boolean(account),
    });

    useEffect(() => {
        if (!account || !chainId) return;

        const bustParam = bustedUser === account ? `?bust=${bustData}` : "";
        const initialUrl = generateAvatarUrl(account) + bustParam;

        const check = async () => {
            setIsCheckingImageExists(true);
            const exists = await checkImageExists(initialUrl, false);
            if (exists) {
                setExistingImageUrl(initialUrl);
            }
            setIsCheckingImageExists(false);
        };

        check();
    }, [account, chainId, bustData, bustedUser]);

    if (!account) {
        return {
            avatarSrc: defaultAvatar,
            type: "default",
            isLoading: false,
        };
    }

    if (isPendingChainId || isCheckingImageExists || !chainId) {
        return {
            avatarSrc: defaultAvatar,
            type: "default",
            isLoading: true,
        };
    }

    if (existingImageUrl) {
        return {
            avatarSrc: existingImageUrl,
            type: "uploaded",
            isLoading: false,
        };
    }

    return {
        avatarSrc: generateAvatar(chainId, account, type),
        type: "generated",
        isLoading: false,
    };
};
