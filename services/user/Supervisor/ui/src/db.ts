// // Task 3: implement get_valid_perm_request() here in JS/Supervisor territory (was in Permissions.plugin)
// use chrono::Utc;
// use uuid::Uuid;
import { v4 as uuidv4 } from 'uuid';
import { supervisor } from './perms_oauth/main';
import { Result } from './hostInterface';
import { RecoverableErrorPayload } from './plugin/errors';

const PERM_REQUEST_EXPIRATION = 2 * 60;
export const PERM_OAUTH_REQ_KEY = "perm_oauth_req";

interface ValidPermissionRequest {
    id: string,
    caller: string,
    callee: string,
}

export class CurrentAccessRequest {

    static async set(caller: string, callee: string): Promise<Result<string, RecoverableErrorPayload>> {
        let req_id = uuidv4();
        await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "setKey",
            params: [
                PERM_OAUTH_REQ_KEY,
                {
                    id: req_id,
                    caller,
                    callee,
                    expiry_timestamp: new Date().getUTCSeconds(),
                }
            ]});
        return req_id
    }

    static async get(id: string): Promise<Result<ValidPermissionRequest, RecoverableErrorPayload>> {
        const perms_req = await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "getKey",
            params: [PERM_OAUTH_REQ_KEY]});

        if (perms_req) {
            let is_expired = (new Date().getUTCSeconds()
                - perms_req.expiry_timestamp.seconds)
                >= PERM_REQUEST_EXPIRATION;

            if (!is_expired && id == perms_req.id) {
                return {
                    id: perms_req.id,
                    caller: perms_req.caller,
                    callee: perms_req.callee,
                };
            }
        }
        return perms_req;
    }

    static async delete() {
        await supervisor.functionCall({
            service: "clientdata",
            intf: "keyvalue",
            method: "deleteKey",
            params: [PERM_OAUTH_REQ_KEY]});

    }

    // Came from admin .wit interface
    static async get_valid_perm_request(id: string): Promise<Result<ValidPermissionRequest, RecoverableErrorPayload>> {
        // verify_caller_is_this_app()?;
        let valid_perm_req = await CurrentAccessRequest.get(id); // , &caller, &callee)?;
        CurrentAccessRequest.delete();
        return valid_perm_req;
    }

}