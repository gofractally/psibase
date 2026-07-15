import { Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { chain, type OpenRelayStatus } from "../lib/chain-endpoints";
import {
    fetchOpenRelayIceServers,
    parseOpenRelayIceServers,
} from "./chat-openrelay/fetch-openrelay-ice";
import { OpenRelayAccountCard } from "./chat-openrelay/openrelay-account-card";
import { PasteIceServersCard } from "./chat-openrelay/paste-ice-servers-card";

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

    const runBusy = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            await fn();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const onSaveCredentialsOnly = () =>
        void runBusy(async () => {
            await chain.putOpenRelay({ appName, apiKey });
            setMessage(
                "Saved app name and API key. Fetch credentials when ready.",
            );
            await refresh();
        });

    const onSaveAndFetch = () =>
        void runBusy(async () => {
            const iceServers = await fetchOpenRelayIceServers(appName, apiKey);
            await chain.putOpenRelay({ appName, apiKey, iceServers });
            setMessage(
                "Fetched TURN credentials from OpenRelay and saved them on this node.",
            );
            await refresh();
        });

    const onPasteSave = () =>
        void runBusy(async () => {
            const parsed: unknown = JSON.parse(pasteJson.trim());
            const iceServers = parseOpenRelayIceServers(parsed);
            await chain.putOpenRelay({
                appName,
                apiKey,
                iceServers,
            });
            setMessage("Saved pasted iceServers JSON.");
            setPasteJson("");
            await refresh();
        });

    const onClear = () =>
        void runBusy(async () => {
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
        });

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

            <OpenRelayAccountCard
                status={status}
                appName={appName}
                apiKey={apiKey}
                busy={busy}
                onAppNameChange={setAppName}
                onApiKeyChange={setApiKey}
                onSaveAndFetch={onSaveAndFetch}
                onSaveCredentialsOnly={onSaveCredentialsOnly}
                onClear={onClear}
            />

            <PasteIceServersCard
                pasteJson={pasteJson}
                busy={busy}
                onPasteJsonChange={setPasteJson}
                onPasteSave={onPasteSave}
            />
        </div>
    );
};
