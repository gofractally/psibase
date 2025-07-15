import { useEffect, useState } from "react";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";

const supervisor = getSupervisor();

interface PermissionRequest {
    user: string;
    caller: string;
    callee: string;
}

export const App = () => {
    const [error, setError] = useState<string | null>(null);
    const [contextId, setContextId] = useState<string | null>(null);
    const [permissionRequest, setPermissionRequest] =
        useState<PermissionRequest | null>(null);

    useEffect(() => {
        const handleError = (error: string) => {
            setError("Permissions request error: " + error);
        };

        const initApp = async () => {
            const cid = prompt.getContextId();
            if (!cid) {
                return handleError("No context id provided");
            }
            setContextId(cid);

            try {
                setPermissionRequest(
                    (await supervisor.functionCall({
                        service: "permissions",
                        intf: "admin",
                        method: "getContext",
                        params: [cid],
                    })) as PermissionRequest,
                );
            } catch {
                return handleError("Failed to get context");
            }
        };

        initApp();
    }, []);

    const approve = async () => {
        await supervisor.functionCall({
            service: "permissions",
            intf: "admin",
            method: "approve",
            params: [contextId],
        });
        prompt.finished();
    };

    const deny = async () => {
        await supervisor.functionCall({
            service: "permissions",
            intf: "admin",
            method: "deny",
            params: [contextId],
        });
        prompt.finished();
    };

    if (error) {
        return <div>{error}</div>;
    } else if (!permissionRequest) {
        return <div>Loading...</div>;
    }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <h2 style={{ textAlign: "center" }}>Permissions</h2>
            <h3>{`Hi ${permissionRequest.user},`}</h3>
            <p>
                {`The "${permissionRequest.caller}" app is requesting full access to use "${permissionRequest.callee}" on your behalf.`}
            </p>
            {!!error && <div>ERROR: {error}</div>}
            <div className="flex justify-center gap-4">
                <Button onClick={approve}>Approve</Button>
                <Button onClick={deny}>Deny</Button>
            </div>
        </div>
    );
};
