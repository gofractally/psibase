import { Result } from '../hostInterface';
import { RecoverableErrorPayload } from '../plugin/errors';
import { PERM_OAUTH_REQ_KEY, PERM_REQUEST_EXPIRATION } from '../constants';
import { getSupervisor } from "@psibase/common-lib";

export const supervisor = getSupervisor();
export interface ValidPermissionRequest {
    id: string,
    permsUrlPath: string,
    returnUrlPath: string,
    payload: {
        caller: string,
        callee: string,
    }
}

export class CurrentAccessRequest {
    static async get(id: string): Promise<Result<ValidPermissionRequest, RecoverableErrorPayload>> {
        const perms_req_bytes = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "get",
            params: [PERM_OAUTH_REQ_KEY]});

        const perms_req = JSON.parse(new TextDecoder().decode(perms_req_bytes));
        if (perms_req) {
            let is_expired = (new Date().getUTCSeconds()
                - perms_req.expiry_timestamp.seconds)
                >= PERM_REQUEST_EXPIRATION;

            if (!is_expired && id == perms_req.id) {
                return {
                    id: perms_req.id,
                    permsUrlPath: perms_req.permsUrlPath,
                    returnUrlPath: perms_req.returnUrlPath,
                    payload: {
                        caller: perms_req.payload.caller,
                        callee: perms_req.payload.callee,
                    }
                } as ValidPermissionRequest;
            }
        }
        return perms_req;
    }

    static async delete() {
        await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "delete",
            params: [PERM_OAUTH_REQ_KEY]});
    }
}