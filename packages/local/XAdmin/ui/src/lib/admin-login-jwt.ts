import { RPCError } from "@psibase/common-lib";
import { z } from "zod";

const AdminLoginReply = z.object({
    access_token: z.string(),
    token_type: z.string(),
});

let accessToken: string | undefined;
let fetchPromise: Promise<string | undefined> | undefined;

async function fetchAdminLoginToken(): Promise<string | undefined> {
    const res = await fetch("/admin_login", {
        headers: { Accept: "application/json" },
    });
    if (res.status === 503) {
        return undefined;
    }
    if (!res.ok) {
        throw new RPCError(await res.text());
    }
    const reply = AdminLoginReply.parse(await res.json());
    if (reply.token_type !== "bearer") {
        throw new Error(
            `unsupported admin login token_type: ${reply.token_type}`,
        );
    }
    return reply.access_token;
}

export async function getAdminLoginAccessToken(): Promise<string | undefined> {
    if (accessToken !== undefined) {
        return accessToken;
    }
    if (fetchPromise === undefined) {
        fetchPromise = (async () => {
            try {
                const token = await fetchAdminLoginToken();
                if (token !== undefined) {
                    accessToken = token;
                }
                return token;
            } finally {
                if (accessToken === undefined) {
                    fetchPromise = undefined;
                }
            }
        })();
    }
    return fetchPromise;
}

export async function adminBearerAuthHeaders(): Promise<
    Record<string, string>
> {
    const token = await getAdminLoginAccessToken();
    if (!token) {
        return {};
    }
    return { Authorization: `Bearer ${token}` };
}
