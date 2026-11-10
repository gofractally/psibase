import { useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { useChainId } from "@shared/hooks/use-chain-id";
import { createIdenticon } from "@shared/lib/create-identicon";
import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export interface TokenIconSource {
    tokenId: number;
    /** Versioned icon path from the GraphQL `icon` field */
    icon?: string | null;
}

interface Props extends Partial<TokenIconSource> {
    /** Reserve tokens of a liquidity pool; renders both icons overlapping instead of this token's icon */
    pair?: readonly [TokenIconSource, TokenIconSource] | null;
    className?: string;
    alt?: string;
}

const SingleTokenIcon = ({
    tokenId,
    icon,
    className,
    alt = "",
}: Partial<TokenIconSource> & { className?: string; alt?: string }) => {
    const { data: chainId } = useChainId();
    const [failedIcon, setFailedIcon] = useState<string | null>(null);
    const iconUrl =
        icon && icon !== failedIcon
            ? siblingUrl(undefined, "tokens", icon)
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
            onError={() => setFailedIcon(icon ?? null)}
            alt={alt}
            className={cn(
                "aspect-square size-6 shrink-0 rounded-full object-cover",
                className,
            )}
        />
    );
};

export const TokenIcon = ({ tokenId, icon, pair, className, alt }: Props) => {
    if (!pair) {
        return (
            <SingleTokenIcon
                tokenId={tokenId}
                icon={icon}
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
