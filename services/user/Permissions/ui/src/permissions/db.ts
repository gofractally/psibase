import { OAUTH_REQUEST_KEY } from "@/constants";
import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

export interface PermsOauthRequest {
    id: string;
    caller: string;
    callee: string;
}

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

        const oauthReq = JSON.parse(new TextDecoder().decode(oauthReqBytes));
        return oauthReq as PermsOauthRequest;
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