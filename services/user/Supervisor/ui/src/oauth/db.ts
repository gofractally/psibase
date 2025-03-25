import { Result } from '../hostInterface';
import { RecoverableErrorPayload } from '../plugin/errors';
import { OAUTH_REQUEST_KEY, PERM_REQUEST_EXPIRATION } from '../constants';
import { getSupervisor } from "@psibase/common-lib";

export const supervisor = getSupervisor();
export interface ValidPermissionRequest {
    id: string,
    subdomain: string,
    subpath: string,
    expiry_timestamp: number,
}

export const isTypeValidPermissionRequest = (
    perms_req_res: ValidPermissionRequest | RecoverableErrorPayload,
): perms_req_res is ValidPermissionRequest => {
    return (
        // "id" in perms_req_res &&
        // "payload" in perms_req_res &&
        // "callee" in perms_req_res.payload &&
        // "caller" in perms_req_res.payload &&
        // "permsUrlPath" in perms_req_res &&
        // "returnUrlPath" in perms_req_res
        "subdomain" in perms_req_res &&
        "subpath" in perms_req_res &&
        "expiry_timestamp" in perms_req_res
    );
};

export class ActiveAccessRequest {
    static async get(id: string): Promise<Result<ValidPermissionRequest, RecoverableErrorPayload>> {
        const perms_req_bytes = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "get",
            params: [OAUTH_REQUEST_KEY]});

        if (!perms_req_bytes) {
            throw "No active oauth request found";
        }

        const perms_req = JSON.parse(new TextDecoder().decode(perms_req_bytes));
        if (id != perms_req.id) {
            await this.delete();
            throw new Error("Oauth request id mismatch");
        }

        let isExpired = (new Date().getUTCSeconds()
            - perms_req.expiry_timestamp.seconds)
            >= PERM_REQUEST_EXPIRATION;
        if (isExpired) {
            await this.delete();
            throw new Error("Oauth request expired");
        }

        return {
            // TODO: ensure anything named "perm" is permissions related; otherwise rename to be userPrompt related
            id: perms_req.id,
            // permsUrlPath: perms_req.permsUrlPath,
            // returnUrlPath: perms_req.returnUrlPath,
            // payload: {
            //     caller: perms_req.payload.caller,
            //     callee: perms_req.payload.callee,
            // }
            subdomain: perms_req.subdomain,
            subpath: perms_req.subpath,
            expiry_timestamp: perms_req.expiry_timestamp,
        } as ValidPermissionRequest;
    }

    static async delete() {
        await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "delete",
            params: [OAUTH_REQUEST_KEY]});
    }
}