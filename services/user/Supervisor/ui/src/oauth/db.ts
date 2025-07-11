import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { OAUTH_REQUEST_KEY } from "../constants";
import { Result } from "../hostInterface";
import { RecoverableErrorPayload } from "../plugin/errors";

export const supervisor = getSupervisor();

export const zOauthRequest = z.object({
    id: z.string().min(1),
    subdomain: z.string().min(1),
    subpath: z.string().min(1),
    expiry_timestamp: z.number().min(0),
});

export type OauthRequest = z.infer<typeof zOauthRequest>;

export class ActiveOauthRequest {
    static async get(
        id: string,
    ): Promise<Result<OauthRequest, RecoverableErrorPayload>> {
        const oauthReqBytes = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "get",
            params: [OAUTH_REQUEST_KEY],
        });

        if (!oauthReqBytes) {
            throw new Error("No active oauth request found");
        }

        const oauthReq = zOauthRequest.parse(
            JSON.parse(new TextDecoder().decode(oauthReqBytes)),
        );
        if (id != oauthReq.id) {
            await this.delete();
            throw new Error("Oauth request id mismatch");
        }

        let isExpired =
            Math.floor(new Date().getTime() / 1000) >=
            oauthReq.expiry_timestamp;
        if (isExpired) {
            await this.delete();
            throw new Error("Oauth request expired");
        }

        return zOauthRequest.parse({
            id: oauthReq.id,
            subdomain: oauthReq.subdomain,
            subpath: oauthReq.subpath,
            expiry_timestamp: oauthReq.expiry_timestamp,
        });
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
