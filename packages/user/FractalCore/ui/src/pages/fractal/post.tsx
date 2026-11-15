import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { usePluginFunctionCallMutation } from "@/hooks/use-plugin-function-call-mutation";
import { formatRawAmount } from "@/lib/format-token";
import {
    getFractalTokenId,
    getPost,
    getThreads,
    nextBidRaw,
    social,
} from "@/lib/social";
import type { PluginCall } from "@/lib/plugin";

import { PageContainer } from "@shared/components/page-container";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";

const WEEK = 7 * 86_400;

const rawToDecimal = (raw: string) => {
    const digits = raw.replace(/^0+/, "") || "0";
    const padded = digits.padStart(5, "0");
    const split = padded.length - 4;
    return `${padded.slice(0, split)}.${padded.slice(split)}`;
};

const seconds = (value: string) => {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 1_000_000_000) return asNumber;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
};

export const Post = () => {
    const { postId } = useParams();
    const id = Number(postId);
    const fractal = useFractalAccount();

    const post = useQuery({
        queryKey: ["social-post", id],
        enabled: Number.isInteger(id),
        queryFn: () => getPost(id),
    });
    const threads = useQuery({
        queryKey: ["social-threads", fractal],
        enabled: Boolean(fractal),
        queryFn: () => getThreads(fractal!),
    });
    const token = useQuery({
        queryKey: ["fractal-token", fractal],
        enabled: Boolean(fractal),
        queryFn: () => getFractalTokenId(fractal!),
    });

    const bid = usePluginFunctionCallMutation(social.bid, {
        toast: { error: "Bid failed", loading: "Bidding", success: "Bid placed" },
        onSuccess: () => void post.refetch(),
    });
    const claim = usePluginFunctionCallMutation(social.claim, {
        toast: { error: "Claim failed", loading: "Claiming", success: "Claimed" },
        onSuccess: () => void post.refetch(),
    });
    const accept = usePluginFunctionCallMutation(
        {
            intf: "user",
            method: "debit",
            service: zAccount.parse("nft"),
        } as PluginCall<[nftId: number, memo: string]>,
        {
            toast: {
                error: "Accept failed",
                loading: "Accepting NFT",
                success: "NFT accepted",
            },
        },
    );

    const row = post.data;
    const thread = threads.data?.find((item) => item.account === row?.thread);
    const closed =
        row != null &&
        seconds(row.createdAt) + (thread?.bidSeconds ?? WEEK) <=
            Math.floor(Date.now() / 1000);
    const next = row ? nextBidRaw(row.lastBid.value) : "0";

    return (
        <PageContainer className="space-y-4">
            <Link to="/threads" className="text-sm underline">
                Threads
            </Link>
            {post.isLoading && (
                <p className="text-muted-foreground text-sm">Loading post.</p>
            )}
            {post.error && (
                <p className="text-sm text-red-600">{post.error.message}</p>
            )}
            {row == null && !post.isLoading && !post.error && (
                <p className="text-muted-foreground text-sm">Post not found.</p>
            )}
            {row && (
                <article className="space-y-3 rounded border p-4">
                    {row.subject ? (
                        <h1 className="text-xl font-semibold">{row.subject}</h1>
                    ) : (
                        <p className="text-muted-foreground text-xs">Short post</p>
                    )}
                    <p className="text-muted-foreground text-sm">
                        {row.author} · last bid {formatRawAmount(row.lastBid.value)} by{" "}
                        {row.bidder}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{row.body}</p>
                    {row.nft != null && (
                        <div className="flex items-center gap-2">
                            <p className="text-sm">
                                NFT {row.nft} is waiting. Accept it to take ownership.
                            </p>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    accept.mutate([row.nft!, "Thread post"])
                                }
                            >
                                Accept
                            </Button>
                        </div>
                    )}
                    <div className="flex gap-2">
                        {!closed && row.nft == null && !row.removed && (
                            <Button
                                size="sm"
                                disabled={token.data == null}
                                onClick={() =>
                                    token.data != null &&
                                    bid.mutate([
                                        row.id,
                                        token.data,
                                        rawToDecimal(next),
                                    ])
                                }
                            >
                                Bid {formatRawAmount(next)}
                            </Button>
                        )}
                        {closed && row.nft == null && !row.removed && (
                            <Button size="sm" onClick={() => claim.mutate([row.id])}>
                                Claim
                            </Button>
                        )}
                    </div>
                </article>
            )}
        </PageContainer>
    );
};
