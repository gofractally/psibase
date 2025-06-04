import { getSupervisor } from "@psibase/common-lib";
import { z } from "zod";
const supervisor = getSupervisor();

export const OAUTH_REQUEST_KEY = "active_oauth_request";

const zPermsOauthRequest = z.object({
    id: z.string(),
    user: z.string(),
    method: z.string(),
    prompt: z.string(),
    caller: z.string(),
    callee: z.string(),
});

type PermsOauthRequest = z.infer<typeof zPermsOauthRequest>;

export class ActivePermsOauthRequest {
    static async get(): Promise<PermsOauthRequest> {
        const oauthReqBytes = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "get",
            params: [OAUTH_REQUEST_KEY]});

        if (!oauthReqBytes) {
            throw new Error("No active oauth request found");
        }

        const oauthReq = zPermsOauthRequest.parse(JSON.parse(new TextDecoder().decode(oauthReqBytes)));
        return oauthReq
    }

    static async delete() {
        await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "delete",
            params: [OAUTH_REQUEST_KEY],
        });
    }
}