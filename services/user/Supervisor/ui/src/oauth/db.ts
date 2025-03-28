import { Result } from '../hostInterface';
import { RecoverableErrorPayload } from '../plugin/errors';
import { OAUTH_REQUEST_KEY, OAUTH_REQUEST_EXPIRATION } from '../constants';
import { getSupervisor } from "@psibase/common-lib";
import { z } from 'zod';

export const supervisor = getSupervisor();

export const OauthRequestSchema = z.object({
    id: z.string().uuid(),
    subdomain: z.string(),
    subpath: z.string(),
    expiry_timestamp: z.number(),
});

export type OauthRequest = z.infer<typeof OauthRequestSchema>;

export class ActiveOauthRequest {
    static async get(id: string): Promise<Result<OauthRequest, RecoverableErrorPayload>> {
        const oauthReqBytes = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "get",
            params: [OAUTH_REQUEST_KEY]});

        if (!oauthReqBytes) {
            throw new Error("No active oauth request found");
        }

        const oauthReq = JSON.parse(new TextDecoder().decode(oauthReqBytes));
        if (id != oauthReq.id) {
            await this.delete();
            throw new Error("Oauth request id mismatch");
        }

        let isExpired = (Math.floor(new Date().getTime() / 1000)
            - oauthReq.expiry_timestamp.seconds)
            >= OAUTH_REQUEST_EXPIRATION;
        if (isExpired) {
            await this.delete();
            throw new Error("Oauth request expired");
        }

        return OauthRequestSchema.parse({
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
            params: [OAUTH_REQUEST_KEY]});
    }
}