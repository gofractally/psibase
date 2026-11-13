import { useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { useChainId } from "@shared/hooks/use-chain-id";
import { createIdenticon } from "@shared/lib/create-identicon";
import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export interface TokenIconSource {
    tokenId: number;
    /** Content hash of the token's icon, from the GraphQL `iconHash` field */
    iconHash?: string | null;
}

interface Props extends Partial<TokenIconSource> {
    /** Reserve tokens of a liquidity pool; rendered overlapping when this token has no icon of its own */
    pair?: readonly [TokenIconSource, TokenIconSource] | null;
    className?: string;
    alt?: string;
}

const SingleTokenIcon = ({
    tokenId,
    iconHash,
    className,
    alt = "",
}: Partial<TokenIconSource> & { className?: string; alt?: string }) => {
    const { data: chainId } = useChainId();
    const [failedHash, setFailedHash] = useState<string | null>(null);
    // The query parameter is ignored by the server; it gives each icon version
    // its own URL so browsers don't keep showing a replaced image.
    const iconUrl =
        tokenId !== undefined && iconHash && iconHash !== failedHash
            ? siblingUrl(undefined, "tokens", `/icon/${tokenId}?v=${iconHash}`)
            : null;

    if (!iconUrl && (!chainId || tokenId === undefined)) {
        return <Skeleton className={cn("size-6 rounded-full", className)} />;
    }

    return (
        <img
            src={
                iconUrl ??
                createIdenticon(`${chainId}token:${tokenId}`, "glass")
            }
            onError={() => setFailedHash(iconHash ?? null)}
            alt={alt}
            className={cn(
                "aspect-square size-6 shrink-0 rounded-full object-cover",
                className,
            )}
        />
    );
};

export const TokenIcon = ({
    tokenId,
    iconHash,
    pair,
    className,
    alt,
}: Props) => {
    if (!pair || iconHash) {
        return (
            <SingleTokenIcon
                tokenId={tokenId}
                iconHash={iconHash}
                className={className}
                alt={alt}
            />
        );
    }

    return (
        <span
            role="img"
            aria-label={alt}
            className={cn("relative inline-block size-6 shrink-0", className)}
        >
            <SingleTokenIcon
                {...pair[0]}
                className="absolute left-0 top-0 size-[70%]"
            />
            <SingleTokenIcon
                {...pair[1]}
                className="ring-background absolute bottom-0 right-0 size-[70%] ring-2"
            />
        </span>
    );
};
