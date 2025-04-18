import { useEffect, useState } from "react";

import {
    Shield,
    User,
    Check,
    X,
    ShieldAlert,
    ShieldEllipsis,
    LoaderCircle,
} from "lucide-react";
import { Button } from "@shadcn/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shadcn/card";
import { Separator } from "@shadcn/separator";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";
import { ActivePermsOauthRequest } from "./db";

const thisServiceName = "permissions";
const supervisor = getSupervisor();

export const App = () => {
    const [isLoading, setIsLoading] = useState(true);
    const [validPermRequest, setValidPermRequest] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const initApp = async () => {
        let permReqPayload;
        try {
            permReqPayload = await ActivePermsOauthRequest.get();
        } catch (e) {
            setError("Permissions request error: " + e);
            setIsLoading(false);
            return;
        }

        const qps = getQueryParams();
        if (qps.id && qps.id != permReqPayload.id) {
            setError("Forged request detected.");
            setIsLoading(false);
            return;
        }

        if (
            !permReqPayload.user ||
            !permReqPayload.caller ||
            !permReqPayload.callee
        ) {
            setError("Invalid permissions request payload: missing fields.");
            setIsLoading(false);
            return;
        }

        setValidPermRequest(permReqPayload);
        setIsLoading(false);
    };

    useEffect(() => {
        initApp();
    }, []);

    const followReturnRedirect = async () => {
        const qps = getQueryParams();
        if (window.top) {
            window.top.location.href = siblingUrl(
                null,
                validPermRequest?.caller,
                qps.returnUrlPath,
                true,
            );
        }
    };

    const approve = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "admin",
                method: "savePerm",
                params: [
                    validPermRequest?.user,
                    validPermRequest?.caller,
                    validPermRequest?.callee,
                ],
            });
            await ActivePermsOauthRequest.delete();
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError("Unknown error saving permission");
            }
            throw e;
        }
        followReturnRedirect();
    };
    const deny = async () => {
        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "admin",
                method: "delPerm",
                params: [
                    validPermRequest?.user,
                    validPermRequest?.caller,
                    validPermRequest?.callee,
                ],
            });
            await ActivePermsOauthRequest.delete();
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError("Unknown error deleting permission");
            }
            throw e;
        }
        followReturnRedirect();
    };

    const getQueryParams = () => {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        return Object.fromEntries(urlParams.entries());
    };

    if (isLoading) {
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <ShieldEllipsis className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">App Permissions</CardTitle>
                    <CardDescription>
                        <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                    </CardDescription>
                </CardHeader>
            </Card>
        </div>;
    }

    if (error) {
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <ShieldAlert className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">
                        App Permissions Error
                    </CardTitle>
                    <CardDescription>
                        <strong>{error}</strong>
                    </CardDescription>
                </CardHeader>
            </Card>
        </div>;
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <Shield className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">App Permissions</CardTitle>
                    <CardDescription>
                        <strong>{validPermRequest?.caller}</strong> is
                        requesting full access to{" "}
                        <strong>{validPermRequest?.callee}</strong>
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-lg border bg-background p-1">
                        <div className="flex items-center gap-3 rounded-md p-3">
                            <div className="h-10 w-10 rounded-md bg-primary/10" />
                            <div>
                                <p className="font-medium">
                                    {validPermRequest?.caller}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div>
                        <p className="mb-3 font-medium">
                            This app will be able to:
                        </p>
                        <ul className="space-y-3">
                            <li className="flex items-start gap-3">
                                <User className="mt-0.5 h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">
                                        Act on your behalf
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Perform actions and queries on the{" "}
                                        {validPermRequest?.callee} service on
                                        your behalf
                                    </p>
                                </div>
                            </li>
                        </ul>
                    </div>

                    <div className="rounded-md bg-muted p-3 text-sm">
                        <p>
                            By approving, you allow this app to perform these
                            actions on your behalf. You can revoke access at any
                            time in your account settings.
                        </p>
                    </div>
                </CardContent>
                <Separator />
                <CardFooter className="flex justify-between gap-2 pt-6">
                    <Button
                        variant="outline"
                        className="flex-1"
                        size="lg"
                        onClick={deny}
                    >
                        <X className="mr-2 h-4 w-4" />
                        Deny
                    </Button>
                    <Button className="flex-1" size="lg" onClick={approve}>
                        <Check className="mr-2 h-4 w-4" />
                        Approve
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};
