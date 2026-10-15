import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { supervisor } from "@shared/lib/supervisor";
import {
    CardContent,
    CardDescription,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Spinner } from "@shared/shadcn/ui/spinner";

import { PortalCard } from "./portal-card";
import { IMPORT_RETURN_PATH } from "../lib/import-return";
import { getSignup } from "../lib/portal-api";
import type { SignupRequest } from "../lib/signup-request";

const POLL_INTERVAL_MS = 1000;

/**
 * Once the node creates the account, leaves the page for the host import
 * prompt, which returns to `IMPORT_RETURN_PATH`.
 */
export const CreatingStep = ({
    request: { name, signupId, privateKeyPem },
    onFailed,
}: {
    request: SignupRequest;
    onFailed: () => void;
}) => {
    const { data: signup, isError } = useQuery({
        queryKey: ["signup", signupId],
        queryFn: () => getSignup(signupId),
        refetchInterval: (query) =>
            query.state.data?.state === "queued" ? POLL_INTERVAL_MS : false,
    });

    const { mutate: importAccount, isIdle: isImportIdle } = useMutation({
        mutationFn: () =>
            supervisor.functionCall(
                {
                    service: "host",
                    plugin: "accounts",
                    intf: "activeApp",
                    method: "importNewAccount",
                    params: [name, privateKeyPem, true],
                },
                { enabled: true, returnPath: IMPORT_RETURN_PATH },
            ),
        onError: (error) => {
            console.error("Failed to open the import prompt:", error);
            onFailed();
        },
    });

    useEffect(() => {
        if (isError || signup?.state === "failed") {
            onFailed();
        } else if (signup?.state === "created" && isImportIdle) {
            importAccount();
        }
    }, [signup?.state, isError, isImportIdle, importAccount, onFailed]);

    return (
        <PortalCard progress={50}>
            <CardContent className="flex flex-col gap-6">
                <div className="space-y-2">
                    <CardTitle className="text-3xl font-normal">
                        Creating account...
                    </CardTitle>
                    <CardDescription>
                        This should only take a few seconds.
                    </CardDescription>
                </div>
                <div className="bg-muted/40 flex items-center justify-center rounded-lg border px-6 py-10">
                    <Spinner className="text-muted-foreground size-5" />
                </div>
            </CardContent>
        </PortalCard>
    );
};
