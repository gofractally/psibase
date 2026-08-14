import { getJson } from "@psibase/common-lib";
import { z } from "zod";

const AdminLoginReply = z
    .object({
        access_token: z.string(),
        token_type: z.string(),
    })
    .strict();

let accessToken: string | undefined;
let fetchPromise: Promise<string> | undefined;

export async function getAdminLoginAccessToken(): Promise<string> {
    if (accessToken !== undefined) {
        return accessToken;
    }
    if (fetchPromise === undefined) {
        fetchPromise = (async () => {
            const reply = AdminLoginReply.parse(await getJson("/admin_login"));
            accessToken = reply.access_token;
            return accessToken;
        })();
    }
    return fetchPromise;
}

export async function adminBearerAuthHeaders(): Promise<{
    Authorization: string;
}> {
    return { Authorization: `Bearer ${await getAdminLoginAccessToken()}` };
}
