import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { BidLeft } from "@/components/relative-time";
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

// Opening a reply keeps the thread page's scroll offset, and inserting the
// parent above the reply makes the browser anchor on the reply. Both leave
// the parent above the fold. Pin to the top until the reader scrolls.
const scrollPageToTop = (from: HTMLElement | null) => {
    window.scrollTo(0, 0);
    let node = from?.parentElement ?? null;
    while (node) {
        if (node.scrollTop !== 0) node.scrollTop = 0;
        node = node.parentElement;
    }
};

export const Post = () => {
    const { postId } = useParams();
    const id = Number(postId);
    const fractal = useFractalAccount();
    const navigate = useNavigate();
    const replyRef = useRef<HTMLTextAreaElement>(null);
    const pageRef = useRef<HTMLDivElement>(null);
    const pinTop = useRef(true);
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
    const owedRaw = owed.data ?? "0";
    const hasCredit = owedRaw !== "0";
    const bodyBytes = utf8Bytes(body);
    const overLimit = bodyBytes > SHORT_POST_BYTES;
    const parent = useQuery({
        queryKey: ["social-post", row?.replyTo],
        enabled: row?.replyTo != null,
        queryFn: () => getPost(row!.replyTo!),
    });

    useLayoutEffect(() => {
        const field = replyRef.current;
        if (!field) return;
        field.style.height = "auto";
        field.style.height = `${field.scrollHeight}px`;
    }, [body]);

    useLayoutEffect(() => {
        pinTop.current = true;
        const unpin = () => {
            pinTop.current = false;
        };
        window.addEventListener("wheel", unpin, { passive: true });
        window.addEventListener("touchmove", unpin, { passive: true });
        return () => {
            window.removeEventListener("wheel", unpin);
            window.removeEventListener("touchmove", unpin);
        };
    }, [id]);

    useLayoutEffect(() => {
        if (!pinTop.current) return;
        let cancel = false;
        const snap = () => {
            if (cancel || !pinTop.current) return;
            scrollPageToTop(pageRef.current);
        };
        snap();
        let inner = 0;
        const outer = requestAnimationFrame(() => {
            snap();
            inner = requestAnimationFrame(snap);
        });
        return () => {
            cancel = true;
            cancelAnimationFrame(outer);
            cancelAnimationFrame(inner);
        };
    }, [id, parent.data?.id, parent.isFetched]);

    const bidOn = (target: SocialPost) => {
        if (fractal == null || token.data == null) return;
        bid.mutate([target.id, token.data, rawToDecimal(nextBidRaw(target.lastBid.value))]);
    };

    const bidControl = (target: SocialPost) => {
        const targetClosed =
            thread != null &&
            unixSeconds(target.createdAt) + thread.bidSeconds <=
                Math.floor(Date.now() / 1000);
        const open =
            !targetClosed &&
            target.nft == null &&
            !target.removed &&
            target.bidder !== currentUser;
        const held = target.bidder === currentUser && target.nft == null && !target.removed;
        if (!open && !held) return null;
        return (
            <span
                className="flex shrink-0 items-center gap-2"
                onClick={(event) => event.stopPropagation()}
            >
                {!targetClosed && thread && (
                    <BidLeft
                        createdAt={target.createdAt}
                        bidSeconds={thread.bidSeconds}
                    />
                )}
                <Button
                    type="button"
                    className="h-8 rounded-full px-3 text-sm font-bold hover:bg-primary/90"
                    disabled={!open || token.data == null}
                    onClick={() => {
                        if (open) bidOn(target);
                    }}
                >
                    {open
                        ? `Bid ${formatRawAmount(nextBidRaw(target.lastBid.value))}`
                        : targetClosed
                          ? "You won"
                          : "Your bid"}
                </Button>
            </span>
        );
    };

    return (
        <div
            ref={pageRef}
            className="flex min-h-0 flex-1 flex-col bg-black [overflow-anchor:none]"
        >
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
                <div
                    className="flex cursor-pointer gap-3 border-b border-[#2f3336] bg-[#16181c] px-4 py-3 hover:bg-[#1d1f23]"
                    onClick={() => navigate(`/threads/${row.thread}/post/${row.replyTo}`)}
                >
                    <Avatar
                        account={parent.data?.author ?? null}
                        className="size-10 shrink-0 self-start border-0 shadow-none"
                    />
                    <div className="min-w-0 flex-1">
                        {parent.isLoading && (
                            <p className="text-muted-foreground text-sm">Loading post.</p>
                        )}
                        {parent.error && (
                            <p className="text-sm text-red-600">{parent.error.message}</p>
                        )}
                        {parent.data == null && !parent.isLoading && !parent.error && (
                            <p className="text-muted-foreground text-sm">Post not found.</p>
                        )}
                        {parent.data && (
                            <>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="truncate text-[17px] leading-6 font-normal text-[#e7e9ea]">
                                        {parent.data.author}
                                    </span>
                                    {bidControl(parent.data)}
                                </div>
                                {parent.data.subject ? (
                                    <p className="mt-1 text-[17px] leading-6 font-normal text-[#e7e9ea]">
                                        {parent.data.subject}
                                    </p>
                                ) : null}
                                <p className="mt-1 text-[17px] leading-6 font-normal whitespace-pre-wrap text-[#e7e9ea]">
                                    {parent.data.removed
                                        ? "This post was removed."
                                        : parent.data.body}
                                </p>
                            </>
                        )}
                    </div>
                </div>
            )}
            {row && (
                <article className="flex gap-3 border-b border-[#2f3336] px-4 py-3">
                    <Avatar
                        account={row.author}
                        className="size-10 border-0 shadow-none"
                    />
                    <div className="min-w-0 flex-1 space-y-3">
                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[17px] leading-6 font-normal">{row.author}</span>
                            {bidControl(row)}
                        </div>
                        {row.replyTo != null && (
                            <p className="text-muted-foreground mt-0.5 text-[17px] leading-6 font-normal">
                                Replying to{" "}
                                <Link
                                    to={`/threads/${row.thread}/post/${row.replyTo}`}
                                    className="font-normal text-[#e7e9ea] hover:underline"
                                >
                                    {parent.data?.author ?? "a post"}
                                </Link>
                            </p>
                        )}
                        {row.subject ? (
                            <h1 className="mt-1 text-[17px] leading-6 font-normal">{row.subject}</h1>
                        ) : null}
                    </div>
                    <p className="text-[17px] leading-6 font-normal whitespace-pre-wrap">{row.body}</p>
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
                    {(hasCredit ||
                        (closed && row.nft == null && !row.removed)) && (
                    <div className="flex gap-2">
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
                    )}
                    </div>
                </article>
            )}
            {row && !row.removed && (
                <form
                    className="flex items-start gap-3 border-b border-[#2f3336] px-4 py-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!body.trim() || overLimit || reply.isPending) return;
                        reply.mutate([row.id, "", body]);
                    }}
                >
                    <Avatar
                        account={currentUser ?? null}
                        className="mt-1 size-10 shrink-0 border-0 shadow-none"
                    />
                    <div className="min-w-0 flex-1">
                        <textarea
                            ref={replyRef}
                            rows={1}
                            className="block max-h-64 min-h-6 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 py-2 text-[17px] leading-6 font-normal text-[#e7e9ea] shadow-none ring-0 outline-none placeholder:text-[#71767b] focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
                            placeholder="Post your reply"
                            value={body}
                            onChange={(event) => setBody(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter" || !event.ctrlKey) return;
                                event.preventDefault();
                                if (!body.trim() || overLimit || reply.isPending) return;
                                event.currentTarget.form?.requestSubmit();
                            }}
                        />
                        <div className="flex items-center justify-end gap-3">
                            {bodyBytes > 0 && (
                                <span
                                    className={
                                        overLimit
                                            ? "text-[13px] font-medium text-red-500 tabular-nums"
                                            : "text-muted-foreground text-[13px] tabular-nums"
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
                        </div>
                    </div>
                </form>
            )}
            {replies.isLoading && (
                <p className="text-muted-foreground px-4 py-3 text-sm">Loading replies.</p>
            )}
            {replies.error && (
                <p className="px-4 py-3 text-sm text-red-600">{replies.error.message}</p>
            )}
            {(replies.data ?? []).map((item) => (
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
                            <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-[17px] leading-6 font-normal">
                                    {item.author}
                                </span>
                                {bidControl(item)}
                            </div>
                            <p className="mt-0.5 text-[17px] leading-6 font-normal whitespace-pre-wrap">
                                {item.body}
                            </p>
                            <p className="text-muted-foreground mt-2 text-[13px]">
                                {formatRawAmount(item.lastBid.value)} · {item.bidder}
                            </p>
                        </div>
                    </article>
                ))}
        </PageContainer>
        </div>
    );
};
