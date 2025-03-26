import { Result } from '../hostInterface';
import { RecoverableErrorPayload } from '../plugin/errors';
import { OAUTH_REQUEST_KEY, OAUTH_REQUEST_EXPIRATION } from '../constants';
import { getSupervisor } from "@psibase/common-lib";

export const supervisor = getSupervisor();
export interface OauthRequest {
    id: string,
    subdomain: string,
    subpath: string,
    expiry_timestamp: number,
}

export const isTypeOauthRequest = (
    oauthReqRes: OauthRequest | RecoverableErrorPayload,
): oauthReqRes is OauthRequest => {
    return (
        "subdomain" in oauthReqRes &&
        "subpath" in oauthReqRes &&
        "expiry_timestamp" in oauthReqRes
    );
};

export class ActiveOauthRequest {
    static async get(id: string): Promise<Result<OauthRequest, RecoverableErrorPayload>> {
        const oauthReqBytes = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "get",
            params: [OAUTH_REQUEST_KEY]});

        if (!oauthReqBytes) {
            throw "No active oauth request found";
        }

        const oauthReq = JSON.parse(new TextDecoder().decode(oauthReqBytes));
        if (id != oauthReq.id) {
            await this.delete();
            throw new Error("Oauth request id mismatch");
        }

        let isExpired = (new Date().getUTCSeconds()
            - oauthReq.expiry_timestamp.seconds)
            >= OAUTH_REQUEST_EXPIRATION;
        if (isExpired) {
            await this.delete();
            throw new Error("Oauth request expired");
        }

        return {
            id: oauthReq.id,
            subdomain: oauthReq.subdomain,
            subpath: oauthReq.subpath,
            expiry_timestamp: oauthReq.expiry_timestamp,
        } as OauthRequest;
    }

    static async delete() {
        await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "delete",
            params: [OAUTH_REQUEST_KEY]});
    }
}