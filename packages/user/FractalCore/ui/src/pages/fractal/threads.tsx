import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { usePluginFunctionCallMutation } from "@/hooks/use-plugin-function-call-mutation";
import { formatRawAmount } from "@/lib/format-token";
import {
    getFee,
    getFractalTokenId,
    getPosts,
    getThreads,
    nextBidRaw,
    social,
} from "@/lib/social";

import { Button } from "@shared/shadcn/ui/button";
import { PageContainer } from "@shared/components/page-container";

const rawToDecimal = (raw: string) => {
    const negative = raw.startsWith("-");
    const digits = (negative ? raw.slice(1) : raw).replace(/^0+/, "") || "0";
    const padded = digits.padStart(5, "0");
    const split = padded.length - 4;
    return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
};

export const Threads = () => {
    const fractal = useFractalAccount();
    const navigate = useNavigate();
    const { thread: routeThread } = useParams();
    const [picked, setPicked] = useState<string | null>(null);
    const name = routeThread ?? picked;
    const [body, setBody] = useState("");
    const [subject, setSubject] = useState("");
    const [guild, setGuild] = useState("");
    const [threadName, setThreadName] = useState("");
    const [title, setTitle] = useState("");

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
        queryKey: ["social-posts", fractal, name],
        enabled: Boolean(fractal && name),
        queryFn: () => getPosts(fractal!, name!),
    });
    const selected = threads.data?.find((thread) => thread.account === name);
    const fee = useQuery({
        queryKey: ["social-fee", fractal, name],
        enabled: Boolean(fractal && name),
        queryFn: () => getFee(fractal!, name!),
    });

    const post = usePluginFunctionCallMutation(social.post, {
        toast: { error: "Post failed", loading: "Posting", success: "Posted" },
        onSuccess: () => {
            setBody("");
            setSubject("");
            void posts.refetch();
            void threads.refetch();
        },
    });
    const createThread = usePluginFunctionCallMutation(social.createThread, {
        toast: {
            error: "Thread failed",
            loading: "Creating thread",
            success: "Thread created",
        },
        onSuccess: () => {
            setThreadName("");
            void threads.refetch();
        },
    });
    const bid = usePluginFunctionCallMutation(social.bid, {
        toast: { error: "Bid failed", loading: "Bidding", success: "Bid placed" },
        onSuccess: () => void posts.refetch(),
    });

    return (
        <PageContainer className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold">Threads</h1>
                <p className="text-muted-foreground text-sm">
                    A thread belongs to this fractal. A short post has no subject. A subject makes it an article.
                </p>
            </div>
            {threads.isLoading && (
                <p className="text-muted-foreground text-sm">Loading threads.</p>
            )}
            {threads.error && (
                <p className="text-sm text-red-600">{threads.error.message}</p>
            )}
            <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void createThread.mutateAsync([
                        guild,
                        threadName,
                        title,
                        false,
                        1000,
                        86400,
                    ]);
                }}
            >
                <input
                    className="rounded border px-3 py-2 text-sm"
                    placeholder="Your guild"
                    value={guild}
                    onChange={(event) => setGuild(event.target.value)}
                />
                <input
                    className="rounded border px-3 py-2 text-sm"
                    placeholder="Thread account"
                    value={threadName}
                    onChange={(event) => setThreadName(event.target.value)}
                />
                <input
                    className="rounded border px-3 py-2 text-sm"
                    placeholder="Title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                />
                <Button
                    type="submit"
                    size="sm"
                    disabled={
                        !guild.trim() ||
                        !threadName.trim() ||
                        !title.trim() ||
                        new TextEncoder().encode(title).length > 80
                    }
                >
                    Create thread
                </Button>
            </form>
            <div className="flex flex-wrap gap-2">
                {(threads.data ?? []).map((thread) => (
                    <Button
                        key={thread.account}
                        variant={thread.account === name ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            setPicked(thread.account);
                            navigate(`/threads/${thread.account}`);
                        }}
                    >
                        {thread.title}
                    </Button>
                ))}
                {threads.data?.length === 0 && (
                    <p className="text-muted-foreground text-sm">No threads yet.</p>
                )}
            </div>
            {selected && fractal && (
                <form
                    className="space-y-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void post.mutateAsync([
                            fractal,
                            selected.account,
                            subject,
                            body,
                            token.data ?? 0,
                            rawToDecimal(fee.data ?? "0"),
                        ]);
                    }}
                >
                    <input
                        className="w-full rounded border px-3 py-2 text-sm"
                        placeholder="Subject, only for an article"
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                    />
                    <textarea
                        className="min-h-24 w-full rounded border px-3 py-2 text-sm"
                        placeholder="Write a post"
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                    />
                    <Button
                        type="submit"
                        size="sm"
                        disabled={!body.trim() || token.data == null || fee.data == null}
                    >
                        Post for {formatRawAmount(fee.data ?? "0")}
                    </Button>
                </form>
            )}
            <div className="space-y-3">
                {posts.isLoading && (
                    <p className="text-muted-foreground text-sm">Loading posts.</p>
                )}
                {posts.error && (
                    <p className="text-sm text-red-600">{posts.error.message}</p>
                )}
                {(posts.data ?? []).map((row) => {
                        const next = nextBidRaw(row.lastBid.value);
                        return (
                            <article
                                key={row.id}
                                className="cursor-pointer rounded border p-3"
                                onClick={() =>
                                    navigate(`/threads/${name}/post/${row.id}`)
                                }
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        {row.subject ? (
                                            <h2 className="font-medium">{row.subject}</h2>
                                        ) : (
                                            <p className="text-muted-foreground text-xs">Short post</p>
                                        )}
                                        <p className="text-muted-foreground text-xs">{row.author}</p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={fractal == null || token.data == null}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            fractal &&
                                                token.data != null &&
                                                bid.mutate([
                                                    row.id,
                                                    token.data,
                                                    rawToDecimal(next),
                                                ]);
                                        }}
                                    >
                                        Bid {formatRawAmount(next)}
                                    </Button>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm">{row.body}</p>
                            </article>
                        );
                    })}
            </div>
        </PageContainer>
    );
};
