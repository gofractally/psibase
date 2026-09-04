import { getJson } from "@psibase/common-lib";
import { z } from "zod";

const AdminLoginReply = z.object({
    access_token: z.string(),
    token_type: z.string(),
});

let accessToken: string | undefined;
let fetchPromise: Promise<string> | undefined;

export async function getAdminLoginAccessToken(): Promise<string> {
    if (accessToken !== undefined) {
        return accessToken;
    }
    if (fetchPromise === undefined) {
        fetchPromise = (async () => {
            try {
                const reply = AdminLoginReply.parse(
                    await getJson("/admin_login"),
                );
                if (reply.token_type !== "bearer") {
                    throw new Error(
                        `unsupported admin login token_type: ${reply.token_type}`,
                    );
                }
                accessToken = reply.access_token;
                return accessToken;
            } finally {
                if (accessToken === undefined) {
                    fetchPromise = undefined;
                }
            }
        })();
    }
    return fetchPromise;
}

export async function adminBearerAuthHeaders(): Promise<{
    Authorization: string;
}> {
    return { Authorization: `Bearer ${await getAdminLoginAccessToken()}` };
}
