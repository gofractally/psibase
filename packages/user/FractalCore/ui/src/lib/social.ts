import { z } from "zod";

import { PluginCall } from "@/lib/plugin";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

const SERVICE = zAccount.parse("social");

const call = <T extends unknown[]>(
    intf: string,
    method: string,
): PluginCall<T> =>
    ({
        intf,
        method,
        service: SERVICE,
    }) as PluginCall<T>;

export const social = {
    graphql: call<[query: string], string>("authorized", "graphql"),
    createThread: call<
        [
            guild: string,
            account: string,
            title: string,
            public: boolean,
        ]
    >("threads", "createThread"),
    post: call<
        [
            fractal: string,
            thread: string,
            subject: string,
            body: string,
            tokenId: number,
            amount: string,
        ]
    >("posts", "post"),
    reply: call<[parent: number, subject: string, body: string]>("posts", "reply"),
    bid: call<[id: number, tokenId: number, amount: string]>("posts", "bid"),
    claim: call<[id: number]>("posts", "claim"),
    collect: call<[tokenId: number, amount: string]>("posts", "collect"),
};

const zThread = z.object({
    account: zAccount,
    title: z.string(),
    creator: zAccount,
    public: z.boolean(),
    feeNft: z.number(),
    bidSeconds: z.number(),
});

const zPost = z.object({
    id: z.number(),
    author: zAccount,
    subject: z.string(),
    body: z.string(),
    lastBid: z.object({
        value: z.union([z.string(), z.number()]).transform(String),
    }),
    bidder: zAccount,
    createdAt: z.union([z.string(), z.number()]).transform(String),
    removed: z.boolean(),
    nft: z.number().nullable(),
    replyTo: z.number().nullable(),
});

export type SocialThread = z.infer<typeof zThread>;
export type SocialPost = z.infer<typeof zPost>;

export const getFractalTokenId = async (fractal: string): Promise<number> => {
    const res = await graphqlAuth(
        fractals.authorized.graphql,
        `{ fractal(fractal: "${fractal}") { tokenId } }`,
    );
    return z.object({ fractal: z.object({ tokenId: z.number() }) }).parse(res)
        .fractal.tokenId;
};

export const getRankedThreads = async (
    fractal: string,
): Promise<{ account: string; title: string; fee: string }[]> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ ranked(fractal: "${fractal}") { account title fee } }`,
    );
    return z
        .object({
            ranked: z
                .object({
                    account: zAccount,
                    title: z.string(),
                    fee: z.union([z.string(), z.number()]).transform(String),
                })
                .array(),
        })
        .parse(res).ranked;
};

export const getThread = async (
    fractal: string,
    account: string,
): Promise<SocialThread | null> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ thread(fractal: "${fractal}", account: "${account}") { account title creator public feeNft bidSeconds } }`,
    );
    return z.object({ thread: zThread.nullable() }).parse(res).thread;
};

export const getThreads = async (fractal: string): Promise<SocialThread[]> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ threads(fractal: "${fractal}", first: 50) { nodes { account title creator public feeNft bidSeconds } } }`,
    );
    return z
        .object({ threads: z.object({ nodes: zThread.array() }) })
        .parse(res).threads.nodes;
};

/** Raw units social has credited to this account and that have not been accepted. */
export const getOwed = async (user: string, tokenId: number): Promise<string> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ owed(user: "${user}", tokenId: ${tokenId}) }`,
    );
    return z
        .object({ owed: z.union([z.string(), z.number()]).transform(String) })
        .parse(res).owed;
};

export const getFee = async (fractal: string, thread: string): Promise<string> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ fee(fractal: "${fractal}", thread: "${thread}") }`,
    );
    return z
        .object({ fee: z.union([z.string(), z.number()]).transform(String) })
        .parse(res).fee;
};

export const getPost = async (
    id: number,
): Promise<(SocialPost & { thread: string }) | null> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ post(id: ${id}) { id author subject body lastBid { value } bidder createdAt removed nft replyTo thread } }`,
    );
    return z
        .object({ post: zPost.extend({ thread: zAccount }).nullable() })
        .parse(res).post;
};

export type OutbidNote = {
    cursor: string;
    post: number;
    thread: string;
    bidder: string;
    returned: string;
};

/** Latest outbid events for this account, newest first. */
export const getNotifications = async (user: string): Promise<OutbidNote[]> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ notifications(user: "${user}", last: 20) { edges { cursor node { post thread bidder returned } } } }`,
    );
    const edges = z
        .object({
            notifications: z.object({
                edges: z
                    .object({
                        cursor: z.union([z.string(), z.number()]).transform(String),
                        node: z.object({
                            post: z.number(),
                            thread: zAccount,
                            bidder: zAccount,
                            returned: z
                                .union([z.string(), z.number()])
                                .transform(String),
                        }),
                    })
                    .array(),
            }),
        })
        .parse(res).notifications.edges;
    return edges.reverse().map((edge) => ({
        cursor: edge.cursor,
        post: edge.node.post,
        thread: edge.node.thread,
        bidder: edge.node.bidder,
        returned: edge.node.returned,
    }));
};

export const getPosts = async (
    fractal: string,
    thread: string,
): Promise<SocialPost[]> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ feed(fractal: "${fractal}", thread: "${thread}") { id author subject body lastBid { value } bidder createdAt removed nft replyTo } }`,
    );
    return z.object({ feed: zPost.array() }).parse(res).feed;
};

const POST_FIELDS =
    "id author subject body lastBid { value } bidder createdAt removed nft replyTo";

/** Direct replies, newest first. */
export const getReplies = async (parent: number): Promise<SocialPost[]> => {
    const res = await graphqlAuth(
        social.graphql,
        `{ replies(parent: ${parent}) { ${POST_FIELDS} } }`,
    );
    return z.object({ replies: zPost.array() }).parse(res).replies;
};

/** GraphQL TimePointSec is an RFC3339 string. A raw unix second is also accepted. */
export const unixSeconds = (value: string): number => {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 1_000_000_000) return asNumber;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
};

/** Next bid is 1,300,000 ppm of the current price, and at least 1 raw unit above it. */
export const nextBidRaw = (stake: string): string => {
    const value = BigInt(stake);
    const marked = (value * 1_300_000n) / 1_000_000n;
    const next = marked > value ? marked : value + 1n;
    return next.toString();
};
