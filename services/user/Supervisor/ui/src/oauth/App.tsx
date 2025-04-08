import { useState, useEffect } from "react";
import { ShieldAlert } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { Card, CardHeader, CardTitle, CardDescription } from "@shadcn/card";

import { ActiveOauthRequest, zOauthRequest, OauthRequest } from "./db";

const buildIframeUrl = (promptUserReq: OauthRequest) => {
    const urlParams = new URLSearchParams(window.location.search);
    const url = siblingUrl(
        null,
        promptUserReq.subdomain,
        promptUserReq.subpath,
        true,
    );
    const newIframeUrl = new URL(url);
    newIframeUrl.searchParams.set("id", promptUserReq.id);
    newIframeUrl.searchParams.set(
        "returnUrlPath",
        urlParams.get("returnUrlPath") || "",
    );
    return newIframeUrl.toString();
};

export const App = () => {
    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const initApp = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const oauth_id = urlParams.get("id");
        if (!oauth_id) {
            setError("Error: No ID provided");
            return;
        }

        try {
            const oauthReqUnchecked = await ActiveOauthRequest.get(oauth_id);
            const oauthReq = zOauthRequest.parse(oauthReqUnchecked);
            setIframeUrl(buildIframeUrl(oauthReq));
            await ActiveOauthRequest.delete();
        } catch (e) {
            setError(String(e));
        }
    };

    useEffect(() => {
        initApp();
    }, []);

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                            <ShieldAlert className="text-primary h-8 w-8" />
                        </div>
                        <CardTitle className="text-2xl">
                            App Permissions Error
                        </CardTitle>
                        <CardDescription>
                            <strong>{error}</strong>
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    return (
        <div
            style={{
                width: "100%",
                height: "100dvh",
                display: "flex",
            }}
        >
            {iframeUrl && (
                <iframe
                    src={iframeUrl}
                    style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                    }}
                />
            )}
        </div>
    );
};
