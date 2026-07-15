import { Loader2 } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import type { OpenRelayStatus } from "../../lib/chain-endpoints";

type Props = {
    status: OpenRelayStatus | null;
    appName: string;
    apiKey: string;
    busy: boolean;
    onAppNameChange: (value: string) => void;
    onApiKeyChange: (value: string) => void;
    onSaveAndFetch: () => void;
    onSaveCredentialsOnly: () => void;
    onClear: () => void;
};

export const OpenRelayAccountCard = ({
    status,
    appName,
    apiKey,
    busy,
    onAppNameChange,
    onApiKeyChange,
    onSaveAndFetch,
    onSaveCredentialsOnly,
    onClear,
}: Props) => (
    <Card>
        <CardHeader>
            <CardTitle>OpenRelay account</CardTitle>
            <CardDescription>
                Use your{" "}
                <a
                    className="text-primary underline"
                    href="https://www.metered.ca/tools/openrelay"
                    target="_blank"
                    rel="noreferrer"
                >
                    OpenRelay / Metered
                </a>{" "}
                app name (subdomain before{" "}
                <code className="text-xs">.metered.live</code>) and API key.
            </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
            {status ? (
                <p className="text-muted-foreground text-sm">
                    Status:{" "}
                    <span className="text-foreground font-medium">
                        {status.configured ? "configured" : "not configured"}
                    </span>
                    {status.hasIceServers
                        ? " · cached TURN/STUN credentials present"
                        : " · no cached credentials (STUN-only fallback until you fetch or paste)"}
                </p>
            ) : null}

            <div className="grid gap-2">
                <Label htmlFor="openrelay-app">App name</Label>
                <Input
                    id="openrelay-app"
                    placeholder="e.g. myapp (→ myapp.metered.live)"
                    value={appName}
                    onChange={(e) => onAppNameChange(e.target.value)}
                    autoComplete="off"
                />
            </div>

            <div className="grid gap-2">
                <Label htmlFor="openrelay-key">API key</Label>
                <Input
                    id="openrelay-key"
                    type="password"
                    placeholder="Metered API key"
                    value={apiKey}
                    onChange={(e) => onApiKeyChange(e.target.value)}
                    autoComplete="off"
                />
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void onSaveAndFetch()}
                >
                    {busy ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Save and fetch credentials
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void onSaveCredentialsOnly()}
                >
                    Save app name and API key only
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onClear()}
                >
                    Clear all
                </Button>
            </div>

            <p className="text-muted-foreground text-xs">
                If your browser blocks the request to Metered (CORS), use “Paste
                JSON” below with the array from the Metered API, or run fetch
                from a trusted machine and paste the result.
            </p>
        </CardContent>
    </Card>
);
