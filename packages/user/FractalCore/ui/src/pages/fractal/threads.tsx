import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useOpenCreateThread } from "@/components/create-thread-host";
import { ThreadSettingsModal } from "@/components/modals/thread-settings-modal";
import { BidLeft, PostedAt } from "@/components/relative-time";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useGuild } from "@/hooks/use-guild";
import { usePluginFunctionCallMutation } from "@/hooks/use-plugin-function-call-mutation";
import { formatRawAmount } from "@/lib/format-token";
import {
    getFee,
    getFractalPosts,
    getFractalTokenId,
    getOwed,
    getPosts,
    getThreads,
    nextBidRaw,
    social,
    unixSeconds,
    type SocialThread,
} from "@/lib/social";

import { useCurrentUser } from "@shared/hooks/use-current-user";

import { Avatar } from "@shared/components/avatar";
import { EmptyBlock } from "@shared/components/empty-block";
import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";

const SHORT_POST_BYTES = 280;

const rawToDecimal = (raw: string) => {
    const negative = raw.startsWith("-");
    const digits = (negative ? raw.slice(1) : raw).replace(/^0+/, "") || "0";
    const padded = digits.padStart(5, "0");
    const split = padded.length - 4;
    return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
};

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

const ThreadCard = ({ thread }: { thread: SocialThread }) => {
    const moderator = useGuild(thread.creator);
    return (
        <Link
            to={`/threads/${thread.account}`}
            className="block rounded-2xl border border-[#2f3336] px-4 py-3 no-underline transition-colors hover:bg-white/[0.03]"
        >
            <p className="text-muted-foreground text-[13px]">{thread.account}</p>
            <p className="mt-0.5 text-[15px] font-bold">{thread.title}</p>
            <p className="text-muted-foreground mt-0.5 text-[13px]">
                Moderated by the {moderator.data?.displayName ?? thread.creator} guild
            </p>
            {thread.description ? (
                <p className="text-muted-foreground mt-1 text-[15px] leading-5 whitespace-pre-wrap">
                    {thread.description}
                </p>
            ) : null}
        </Link>
    );
};

export const Threads = () => {
    const fractal = useFractalAccount();
    const navigate = useNavigate();
    const openCreateThread = useOpenCreateThread();
    const { thread: name } = useParams();
    const all = name === "~all";
    const [body, setBody] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const bodyBytes = utf8Bytes(body);
    const overLimit = bodyBytes > SHORT_POST_BYTES;

    const token = useQuery({
        queryKey: ["fractal-token", fractal],
        enabled: Boolean(fractal),
        queryFn: () => getFractalTokenId(fractal!),
    });
    const threads = useQuery({
        queryKey: ["social-threads", fractal],
        enabled: Boolean(fractal),
        queryFn: () => getThreads(fractal!),
    });
    const posts = useQuery({
        queryKey: all
            ? ["social-fractal-posts", fractal]
            : ["social-posts", fractal, name],
        enabled: Boolean(fractal && name),
        queryFn: () =>
            all ? getFractalPosts(fractal!) : getPosts(fractal!, name!),
    });
    const selected = threads.data?.find((thread) => thread.account === name);
    const moderator = useGuild(selected?.creator);
    const fee = useQuery({
        queryKey: ["social-fee", fractal, name],
        enabled: Boolean(fractal && name),
        queryFn: () => getFee(fractal!, name!),
    });
    const { data: currentUser } = useCurrentUser();
    const owed = useQuery({
        queryKey: ["social-owed", currentUser, token.data],
        enabled: Boolean(currentUser && token.data != null),
        queryFn: () => getOwed(currentUser!, token.data!),
    });
    const owedRaw = owed.data ?? "0";
    const hasCredit = owedRaw !== "0";
    const feeAmount = fee.data == null ? null : formatRawAmount(fee.data);

    const post = usePluginFunctionCallMutation(social.post, {
        toast: { error: "Post failed", loading: "Posting", success: "Posted" },
        onSuccess: () => {
            setBody("");
            void posts.refetch();
            void threads.refetch();
            void owed.refetch();
        },
    });
    const bid = usePluginFunctionCallMutation(social.bid, {
        toast: { error: "Bid failed", loading: "Bidding", success: "Bid placed" },
        onSuccess: () => {
            void posts.refetch();
            void owed.refetch();
        },
    });
    const collect = usePluginFunctionCallMutation(social.collect, {
        toast: { error: "Claim failed", loading: "Claiming", success: "Claimed" },
        onSuccess: () => void owed.refetch(),
    });

    useEffect(() => {
        const field = composerRef.current;
        if (!field) return;
        field.style.height = "auto";
        field.style.height = `${field.scrollHeight}px`;
    }, [body, selected]);

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-black">
        <PageContainer className="relative z-[1] mx-auto box-border flex w-full max-w-[600px] min-h-0 min-w-0 shrink-0 grow flex-col content-start items-stretch space-y-0 border-x border-solid border-[#2f3336] bg-black p-0 font-[TwitterChirp,-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif] text-[15px] text-[#e7e9ea] [color-scheme:dark] [-webkit-text-size-adjust:100%] [scrollbar-color:rgb(62,65,68)_rgb(22,24,28)]">
            {threads.isLoading ? (
                <EmptyBlock isLoading title="No threads" />
            ) : !all && threads.data?.length === 0 ? (
                <div className="p-4">
                    <EmptyBlock
                        title="No threads"
                        description="No threads have been created in this fractal yet."
                        buttonLabel="Create a thread"
                        onButtonClick={openCreateThread}
                    />
                </div>
            ) : (
            <>
            {all && (
                <div className="px-4 py-3">
                    <h1 className="text-xl font-semibold">All</h1>
                    <p className="text-muted-foreground text-sm">
                        Posts from every thread
                    </p>
                </div>
            )}
            {!name && (
                <div className="flex flex-col gap-3 p-4">
                    <h1 className="text-xl font-semibold">Threads</h1>
                    {(threads.data ?? []).map((thread) => (
                        <ThreadCard key={thread.account} thread={thread} />
                    ))}
                </div>
            )}
            {selected && (
                <div className="px-4 py-3">
                    <h1 className="text-xl font-semibold">{selected.title}</h1>
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-muted-foreground min-w-0 text-sm">
                            Moderated by the {moderator.data?.displayName ?? selected.creator} guild
                        </p>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground shrink-0 rounded-full"
                            aria-label="Thread settings"
                            onClick={() => setShowSettings(true)}
                        >
                            <Settings />
                        </Button>
                    </div>
                </div>
            )}
            {selected && (
                <ThreadSettingsModal
                    show={showSettings}
                    openChange={setShowSettings}
                    fractal={fractal}
                    thread={selected}
                />
            )}
            {threads.error && (
                <p className="text-sm text-red-600">{threads.error.message}</p>
            )}
            {selected && fractal && (
                <form
                    className="flex items-start gap-3 border-b border-[#2f3336] px-4 py-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void post.mutateAsync([
                            fractal,
                            selected.account,
                            "",
                            body,
                            token.data ?? 0,
                            rawToDecimal(fee.data ?? "0"),
                        ]);
                    }}
                >
                    <Avatar
                        account={currentUser ?? null}
                        className="mt-1 size-10 border-0 shadow-none"
                    />
                    <div className="min-w-0 flex-1">
                        <textarea
                            ref={composerRef}
                            className="block max-h-64 min-h-6 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 py-2 text-xl leading-6 shadow-none ring-0 outline-none placeholder:text-muted-foreground focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
                            placeholder="What's happening?"
                            value={body}
                            rows={1}
                            onChange={(event) => setBody(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter" || !event.ctrlKey) return;
                                event.preventDefault();
                                if (
                                    !body.trim() ||
                                    overLimit ||
                                    token.data == null ||
                                    fee.data == null ||
                                    post.isPending
                                ) {
                                    return;
                                }
                                event.currentTarget.form?.requestSubmit();
                            }}
                        />
                        <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-3">
                            <div className="mr-auto flex items-center gap-3">
                                {hasCredit && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-8 rounded-full px-3 text-sm"
                                        disabled={token.data == null || collect.isPending}
                                        onClick={() => {
                                            if (token.data == null) return;
                                            collect.mutate([
                                                token.data,
                                                rawToDecimal(owedRaw),
                                            ]);
                                        }}
                                    >
                                        Claim {formatRawAmount(owedRaw)}
                                    </Button>
                                )}
                            </div>
                            {bodyBytes > 0 && (
                                <span
                                    className={
                                        overLimit
                                            ? "text-[13px] font-medium text-red-500 tabular-nums"
                                            : bodyBytes > SHORT_POST_BYTES - 20
                                              ? "text-[13px] text-amber-500 tabular-nums"
                                              : "text-muted-foreground text-[13px] tabular-nums"
                                    }
                                >
                                    {SHORT_POST_BYTES - bodyBytes}
                                </span>
                            )}
                            <Button
                                type="submit"
                                className="h-9 rounded-full px-4 text-[15px] font-bold hover:bg-primary/90"
                                disabled={
                                    !body.trim() ||
                                    overLimit ||
                                    token.data == null ||
                                    fee.data == null ||
                                    post.isPending
                                }
                            >
                                {feeAmount == null
                                    ? "Post"
                                    : feeAmount === "0"
                                      ? "Post (Free)"
                                      : `Post (${feeAmount})`}
                            </Button>
                        </div>
                    </div>
                </form>
            )}
            {name && (
            <div className="flex w-full min-w-0 grow flex-col">
                {posts.isLoading && (
                    <p className="text-muted-foreground px-4 py-3 text-sm">
                        Loading posts.
                    </p>
                )}
                {posts.error && (
                    <p className="px-4 py-3 text-sm text-red-600">{posts.error.message}</p>
                )}
                {(posts.data ?? []).map((row) => {
                    const next = nextBidRaw(row.lastBid.value);
                    const owner = all
                        ? threads.data?.find((thread) => thread.account === row.thread)
                        : selected;
                    const window = owner?.bidSeconds;
                    const closed =
                        window != null &&
                        unixSeconds(row.createdAt) + window <=
                            Math.floor(Date.now() / 1000);
                    const canBid =
                        !closed &&
                        row.nft == null &&
                        !row.removed &&
                        row.bidder !== currentUser;
                    const held =
                        row.bidder === currentUser &&
                        row.nft == null &&
                        !row.removed;
                    const bidButton = canBid ? (
                        <Button
                            type="button"
                            className="h-8 rounded-full px-3 text-sm font-bold hover:bg-primary/90"
                            disabled={fractal == null || token.data == null}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (fractal == null || token.data == null) return;
                                bid.mutate([
                                    row.id,
                                    token.data,
                                    rawToDecimal(next),
                                ]);
                            }}
                        >
                            Bid {formatRawAmount(next)}
                        </Button>
                    ) : held ? (
                        <Button
                            type="button"
                            className="h-8 rounded-full px-3 text-sm font-bold"
                            disabled
                            onClick={(event) => event.stopPropagation()}
                        >
                            {closed ? "You won" : "Your bid"}
                        </Button>
                    ) : null;
                    return (
                        <article
                            key={row.id}
                            className="relative m-0 box-border flex min-h-0 min-w-0 shrink-0 cursor-pointer list-none flex-row content-start items-stretch gap-3 overflow-hidden border-x-0 border-t-0 border-b border-[#2f3336] bg-transparent px-4 py-3 text-[15px] leading-5 text-[#e7e9ea] no-underline outline-none transition-[background-color,box-shadow] duration-200 hover:bg-white/[0.03]"
                            style={{
                                fontFamily:
                                    "TwitterChirp, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                                WebkitTextSizeAdjust: "100%",
                                WebkitTapHighlightColor: "rgba(0,0,0,0)",
                            }}
                            onClick={() =>
                                navigate(`/threads/${row.thread}/post/${row.id}`)
                            }
                        >
                            <Avatar
                                account={row.author}
                                className="size-10 border-0 shadow-none"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-baseline gap-2">
                                        <span className="truncate text-[15px] font-bold">
                                            {row.author}
                                        </span>
                                        <PostedAt value={row.createdAt} />
                                    </div>
                                    {bidButton && (
                                        <div className="flex shrink-0 items-center gap-2">
                                            {!closed && owner && (
                                                <BidLeft
                                                    createdAt={row.createdAt}
                                                    bidSeconds={owner.bidSeconds}
                                                />
                                            )}
                                            {bidButton}
                                        </div>
                                    )}
                                </div>
                                {all && (
                                    <p className="text-muted-foreground text-[13px]">
                                        {owner?.title ?? row.thread}
                                    </p>
                                )}
                                {row.subject ? (
                                    <p className="mt-0.5 font-semibold">{row.subject}</p>
                                ) : null}
                                <p className="mt-0.5 text-[15px] leading-5 whitespace-pre-wrap">
                                    {row.body}
                                </p>
                                <p className="text-muted-foreground mt-2 text-[13px]">
                                    {formatRawAmount(row.lastBid.value)} · {row.bidder}
                                </p>
                            </div>
                        </article>
                    );
                })}
            </div>
            )}
            </>
            )}
        </PageContainer>
        </div>
    );
};
