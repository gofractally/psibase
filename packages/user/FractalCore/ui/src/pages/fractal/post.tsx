import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { usePluginFunctionCallMutation } from "@/hooks/use-plugin-function-call-mutation";
import { formatRawAmount } from "@/lib/format-token";
import {
    getFractalTokenId,
    getOwed,
    getPost,
    getReplies,
    getThread,
    nextBidRaw,
    type SocialPost,
    social,
    unixSeconds,
} from "@/lib/social";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import type { PluginCall } from "@/lib/plugin";

import { Avatar } from "@shared/components/avatar";
import { PageContainer } from "@shared/components/page-container";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";



const SHORT_POST_BYTES = 280;

const rawToDecimal = (raw: string) => {
    const digits = raw.replace(/^0+/, "") || "0";
    const padded = digits.padStart(5, "0");
    const split = padded.length - 4;
    return `${padded.slice(0, split)}.${padded.slice(split)}`;
};

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

export const Post = () => {
    const { postId } = useParams();
    const id = Number(postId);
    const fractal = useFractalAccount();
    const navigate = useNavigate();
    const replyRef = useRef<HTMLTextAreaElement>(null);
    const [body, setBody] = useState("");

    const post = useQuery({
        queryKey: ["social-post", id],
        enabled: Number.isInteger(id),
        queryFn: () => getPost(id),
    });
    const threadQuery = useQuery({
        queryKey: ["social-thread", fractal, post.data?.thread],
        enabled: Boolean(fractal && post.data?.thread),
        queryFn: () => getThread(fractal!, post.data!.thread),
    });
    const token = useQuery({
        queryKey: ["fractal-token", fractal],
        enabled: Boolean(fractal),
        queryFn: () => getFractalTokenId(fractal!),
    });
    const replies = useQuery({
        queryKey: ["social-replies", id],
        enabled: Number.isInteger(id),
        queryFn: () => getReplies(id),
    });
    const { data: currentUser } = useCurrentUser();
    const owed = useQuery({
        queryKey: ["social-owed", currentUser, token.data],
        enabled: Boolean(currentUser && token.data != null),
        queryFn: () => getOwed(currentUser!, token.data!),
    });

    const bid = usePluginFunctionCallMutation(social.bid, {
        toast: { error: "Bid failed", loading: "Bidding", success: "Bid placed" },
        onSuccess: () => {
            void post.refetch();
            void replies.refetch();
            void owed.refetch();
        },
    });
    const reply = usePluginFunctionCallMutation(social.reply, {
        toast: { error: "Reply failed", loading: "Replying", success: "Replied" },
        onSuccess: () => {
            setBody("");
            if (replyRef.current) replyRef.current.style.height = "auto";
            void replies.refetch();
        },
    });
    const collect = usePluginFunctionCallMutation(social.collect, {
        toast: { error: "Claim failed", loading: "Claiming", success: "Claimed" },
        onSuccess: () => void owed.refetch(),
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
    const thread = threadQuery.data;
    const closed =
        row != null &&
        thread != null &&
        unixSeconds(row.createdAt) + thread.bidSeconds <= Math.floor(Date.now() / 1000);
    const next = row ? nextBidRaw(row.lastBid.value) : "0";
    const owedRaw = owed.data ?? "0";
    const hasCredit = owedRaw !== "0";
    const canBid =
        row != null &&
        !closed &&
        row.nft == null &&
        !row.removed &&
        row.bidder !== currentUser;
    const bodyBytes = utf8Bytes(body);
    const overLimit = bodyBytes > SHORT_POST_BYTES;
    const parent = useQuery({
        queryKey: ["social-post", row?.replyTo],
        enabled: row?.replyTo != null,
        queryFn: () => getPost(row!.replyTo!),
    });

    const bidOn = (target: SocialPost) => {
        if (fractal == null || token.data == null) return;
        bid.mutate([target.id, token.data, rawToDecimal(nextBidRaw(target.lastBid.value))]);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-black">
        <PageContainer className="relative z-[1] mx-auto box-border flex w-full max-w-[600px] min-h-0 min-w-0 shrink-0 grow flex-col content-start items-stretch space-y-0 border-x border-solid border-[#2f3336] bg-black p-0 text-[15px] text-[#e7e9ea] [color-scheme:dark]">
            <Link
                to={row ? `/threads/${row.thread}` : "/threads"}
                className="text-muted-foreground px-4 py-3 text-sm hover:underline"
            >
                Thread
            </Link>
            {post.isLoading && (
                <p className="text-muted-foreground px-4 py-3 text-sm">Loading post.</p>
            )}
            {post.error && (
                <p className="px-4 py-3 text-sm text-red-600">{post.error.message}</p>
            )}
            {row == null && !post.isLoading && !post.error && (
                <p className="text-muted-foreground px-4 py-3 text-sm">Post not found.</p>
            )}
            {row?.replyTo != null && (
                <p className="text-muted-foreground px-4 text-sm">
                    Replying to{" "}
                    <Link
                        to={`/threads/${row.thread}/post/${row.replyTo}`}
                        className="font-semibold text-[#e7e9ea] hover:underline"
                    >
                        {parent.data?.author ?? "a post"}
                    </Link>
                </p>
            )}
            {row && (
                <article className="flex gap-3 border-b border-[#2f3336] px-4 py-3">
                    <Avatar
                        account={row.author}
                        className="size-10 border-0 shadow-none"
                    />
                    <div className="min-w-0 flex-1 space-y-3">
                    <div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-[15px] font-bold">{row.author}</span>
                            <span className="text-muted-foreground text-[13px]">
                                last bid {formatRawAmount(row.lastBid.value)} by {row.bidder}
                            </span>
                        </div>
                        {row.subject ? (
                            <h1 className="mt-1 text-xl font-semibold">{row.subject}</h1>
                        ) : null}
                    </div>
                    <p className="text-[15px] leading-5 whitespace-pre-wrap">{row.body}</p>
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
                        {canBid && (
                            <Button
                                className="h-9 rounded-full px-4 text-[15px] font-bold hover:bg-primary/90"
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
                        {hasCredit && (
                            <Button
                                variant="outline"
                                className="h-9 rounded-full px-4"
                                disabled={token.data == null}
                                onClick={() =>
                                    token.data != null &&
                                    collect.mutate([
                                        token.data,
                                        rawToDecimal(owedRaw),
                                    ])
                                }
                            >
                                Claim {formatRawAmount(owedRaw)}
                            </Button>
                        )}
                        {closed && row.nft == null && !row.removed && (
                            <Button
                                variant="outline"
                                className="h-9 rounded-full px-4"
                                onClick={() => claim.mutate([row.id])}
                            >
                                Take NFT
                            </Button>
                        )}
                    </div>
                    </div>
                </article>
            )}
            {row && !row.removed && (
                <form
                    className="flex items-center gap-3 border-b border-[#2f3336] px-4 pt-1 pb-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!body.trim() || overLimit || reply.isPending) return;
                        reply.mutate([row.id, "", body]);
                    }}
                >
                    <Avatar
                        account={currentUser ?? null}
                        className="size-10 shrink-0 border-0 shadow-none"
                    />
                    <textarea
                        ref={replyRef}
                        className="max-h-40 min-h-6 flex-1 resize-none overflow-y-auto border-0 bg-transparent py-2 text-xl leading-6 text-[#e7e9ea] placeholder:text-[#71767b] focus:outline-none"
                        placeholder="Post your reply"
                        value={body}
                        rows={1}
                        onChange={(event) => {
                            setBody(event.target.value);
                            const field = event.currentTarget;
                            field.style.height = "auto";
                            field.style.height = `${field.scrollHeight}px`;
                        }}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter" || !event.ctrlKey) return;
                            event.preventDefault();
                            if (!body.trim() || overLimit || reply.isPending) return;
                            event.currentTarget.form?.requestSubmit();
                        }}
                    />
                    {bodyBytes > 0 && (
                        <span
                            className={
                                overLimit
                                    ? "shrink-0 text-[13px] font-medium text-red-500 tabular-nums"
                                    : "text-muted-foreground shrink-0 text-[13px] tabular-nums"
                            }
                        >
                            {SHORT_POST_BYTES - bodyBytes}
                        </span>
                    )}
                    <Button
                        type="submit"
                        className="h-8 shrink-0 rounded-full bg-[#eff3f4] px-4 text-[15px] font-bold text-[#0f1419] hover:bg-[#d7dbdc] disabled:bg-[#eff3f4] disabled:text-[#0f1419]"
                        disabled={!body.trim() || overLimit || reply.isPending}
                    >
                        Reply
                    </Button>
                </form>
            )}
            {replies.isLoading && (
                <p className="text-muted-foreground px-4 py-3 text-sm">Loading replies.</p>
            )}
            {replies.error && (
                <p className="px-4 py-3 text-sm text-red-600">{replies.error.message}</p>
            )}
            {(replies.data ?? []).map((item) => {
                const itemClosed =
                    thread != null &&
                    unixSeconds(item.createdAt) + thread.bidSeconds <=
                        Math.floor(Date.now() / 1000);
                const canBidItem =
                    !itemClosed &&
                    item.nft == null &&
                    !item.removed &&
                    item.bidder !== currentUser;
                return (
                    <article
                        key={item.id}
                        className="flex cursor-pointer gap-3 border-b border-[#2f3336] px-4 py-3 hover:bg-white/[0.03]"
                        onClick={() => navigate(`/threads/${row?.thread}/post/${item.id}`)}
                    >
                        <Avatar
                            account={item.author}
                            className="size-10 border-0 shadow-none"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className="truncate text-[15px] font-bold">
                                    {item.author}
                                </span>
                            </div>
                            <p className="mt-0.5 text-[15px] leading-5 whitespace-pre-wrap">
                                {item.body}
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-muted-foreground text-[13px]">
                                    {formatRawAmount(item.lastBid.value)} · {item.bidder}
                                </span>
                                {canBidItem ? (
                                    <Button
                                        type="button"
                                        className="h-8 rounded-full px-3 text-sm font-bold hover:bg-primary/90"
                                        disabled={token.data == null}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            bidOn(item);
                                        }}
                                    >
                                        Bid {formatRawAmount(nextBidRaw(item.lastBid.value))}
                                    </Button>
                                ) : item.bidder === currentUser &&
                                  item.nft == null &&
                                  !item.removed ? (
                                    <Button
                                        type="button"
                                        className="h-8 rounded-full px-3 text-sm font-bold"
                                        disabled
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        {itemClosed ? "You won" : "Your bid"}
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </article>
                );
            })}
        </PageContainer>
        </div>
    );
};
