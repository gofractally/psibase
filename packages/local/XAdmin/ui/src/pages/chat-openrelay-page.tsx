import { Loader2, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { Textarea } from "@shared/shadcn/ui/textarea";

import { chain, type OpenRelayStatus } from "../lib/chain-endpoints";

async function fetchOpenRelayIceServers(
    appName: string,
    apiKey: string,
): Promise<unknown[]> {
    const sub = appName
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\.metered\.live\/?$/i, "");
    if (!sub || !apiKey.trim()) {
        throw new Error(
            "App name and API key are required to fetch from OpenRelay.",
        );
    }
    const url = `https://${sub}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey.trim())}`;
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `OpenRelay request failed (${res.status}). ${text.slice(0, 240)}`,
        );
    }
    const data: unknown = await res.json();
    if (Array.isArray(data)) return data;
    if (
        data &&
        typeof data === "object" &&
        "iceServers" in data &&
        Array.isArray((data as { iceServers: unknown }).iceServers)
    ) {
        return (data as { iceServers: unknown[] }).iceServers;
    }
    throw new Error(
        "Unexpected JSON from OpenRelay. Paste the iceServers array manually below.",
    );
}

export const ChatOpenRelayPage = () => {
    const [status, setStatus] = useState<OpenRelayStatus | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [appName, setAppName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [pasteJson, setPasteJson] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoadError(null);
        try {
            const s = await chain.getOpenRelay();
            setStatus(s);
            setAppName(s.appName ?? "");
        } catch (e) {
            setLoadError(
                e instanceof Error
                    ? e.message
                    : "Failed to load TURN configuration",
            );
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const onSaveCredentialsOnly = async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            await chain.putOpenRelay({
                appName,
                apiKey,
            });
            setMessage("Saved app name and API key. Fetch credentials when ready.");
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const onSaveAndFetch = async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            const iceServers = await fetchOpenRelayIceServers(appName, apiKey);
            await chain.putOpenRelay({
                appName,
                apiKey,
                iceServers,
            });
            setMessage(
                "Fetched TURN credentials from OpenRelay and saved them on this node.",
            );
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const onPasteSave = async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            const parsed: unknown = JSON.parse(pasteJson.trim());
            if (!Array.isArray(parsed)) {
                throw new Error("Paste a JSON array of ice server objects.");
            }
            await chain.putOpenRelay({
                appName,
                apiKey,
                iceServers: parsed,
            });
            setMessage("Saved pasted iceServers JSON.");
            setPasteJson("");
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const onClear = async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            await chain.putOpenRelay({
                appName: "",
                apiKey: "",
                iceServers: [],
            });
            setAppName("");
            setApiKey("");
            setPasteJson("");
            setMessage("Cleared TURN/OpenRelay settings on this node.");
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-1 flex-col gap-6 p-6">
            <div className="flex items-center gap-3">
                <Video className="size-8" aria-hidden />
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Chat WebRTC / TURN
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Configure Metered OpenRelay so Chat Meet calls can use
                        TURN when direct or STUN-only paths fail. Credentials
                        stay on this node; Homepage clients receive only
                        browser-safe ICE entries after websocket login.
                    </p>
                </div>
            </div>

            {loadError ? (
                <p className="text-destructive text-sm">{loadError}</p>
            ) : null}
            {message ? (
                <p className="text-sm text-green-700 dark:text-green-400">
                    {message}
                </p>
            ) : null}
            {error ? (
                <p className="text-destructive text-sm whitespace-pre-wrap">
                    {error}
                </p>
            ) : null}

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
                        <code className="text-xs">.metered.live</code>) and API
                        key.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {status ? (
                        <p className="text-muted-foreground text-sm">
                            Status:{" "}
                            <span className="text-foreground font-medium">
                                {status.configured
                                    ? "configured"
                                    : "not configured"}
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
                            onChange={(e) => setAppName(e.target.value)}
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
                            onChange={(e) => setApiKey(e.target.value)}
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
                        If your browser blocks the request to Metered (CORS),
                        use “Paste JSON” below with the array from the Metered
                        API, or run fetch from a trusted machine and paste the
                        result.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Paste iceServers JSON</CardTitle>
                    <CardDescription>
                        Optional fallback: paste the JSON{" "}
                        <strong>array</strong> returned by OpenRelay&apos;s
                        credentials endpoint. App name and API key above are
                        still saved if provided.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <Textarea
                        placeholder='[{"urls":["turn:…"],"username":"…","credential":"…"}, …]'
                        value={pasteJson}
                        onChange={(e) => setPasteJson(e.target.value)}
                        rows={8}
                        className="font-mono text-xs"
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || !pasteJson.trim()}
                        onClick={() => void onPasteSave()}
                    >
                        Save pasted iceServers
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};
