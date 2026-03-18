import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { siblingUrl } from "@psibase/common-lib";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/shadcn/ui/select";
import { Toaster, toast } from "@shared/shadcn/ui/sonner";
import { graphql } from "@shared/lib/graphql";

type Scheme = "http" | "https";
type ProxyRow = {
    appName: string;
    scheme: Scheme;
    host: string;
    saved?: boolean;
};

type OriginServerResponse = {
    subdomain: string;
    host: string;
    tls?: Record<string, never> | null;
};

function normalizeOriginRow(r: OriginServerResponse): ProxyRow {
    const scheme: Scheme = r.tls ? "https" : "http";
    let host = r.host.trim();

    const slash = host.indexOf("/");
    if (slash !== -1) host = host.slice(0, slash);
    while (host.endsWith("/")) host = host.slice(0, -1);

    return { appName: r.subdomain, scheme, host, saved: true };
}

async function fetchOriginServers(): Promise<ProxyRow[]> {
    const data = await graphql<{ originServers: OriginServerResponse[] }>(
        `
        {
            originServers {
                subdomain
                host
                tls {}
            }
        }
        `,
        { service: "x-proxy" },
    );
    return data.originServers.map(normalizeOriginRow);
}

async function saveRows(rows: ProxyRow[]): Promise<void> {
    const registerUrl = siblingUrl(null, "x-http", "/register_server");
    const setOriginUrl = siblingUrl(null, "x-proxy", "/set_origin_server");
    const opts = { headers: { "Content-Type": "application/json" } };

    for (const row of rows) {
        const regRes = await fetch(registerUrl, {
            ...opts,
            method: "POST",
            body: JSON.stringify({ service: row.appName, server: "x-proxy" }),
        });
        if (!regRes.ok)
            throw new Error(`register_server: ${await regRes.text()}`);

        const originRes = await fetch(setOriginUrl, {
            ...opts,
            method: "POST",
            body: (() => {
                let host = row.host.trim();
                const scheme = row.scheme;

                const slash = host.indexOf("/");
                if (slash !== -1) host = host.slice(0, slash);
                while (host.endsWith("/")) host = host.slice(0, -1);

                const body: {
                    subdomain: string;
                    host: string;
                    tls?: Record<string, never>;
                } = { subdomain: row.appName, host };
                if (scheme === "https") body.tls = {};
                return JSON.stringify(body);
            })(),
        });
        if (!originRes.ok)
            throw new Error(`set_origin_server: ${await originRes.text()}`);
    }
}

function ProxyEditor({
    initialRows,
    queryClient,
}: {
    initialRows: ProxyRow[];
    queryClient: ReturnType<typeof useQueryClient>;
}) {
    const [rows, setRows] = useState<ProxyRow[]>(() =>
        initialRows.map((r) => ({ ...r })),
    );
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const addRow = () =>
        setRows((prev) => [
            ...prev,
            { appName: "", scheme: "http", host: "", saved: false },
        ]);
    type EditableField = "appName" | "scheme" | "host";
    const updateRow = (i: number, field: EditableField, value: string) =>
        setRows((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], [field]: value };
            return next;
        });

    const onSave = async () => {
        setMessage(null);
        setSaving(true);
        try {
            await saveRows(rows);
            await queryClient.invalidateQueries({
                queryKey: ["origin_servers"],
            });
            toast("Saved.");
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Save failed";
            setMessage(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-2xl p-4">
            <h1 className="mb-4 text-xl font-medium">Reverse proxy</h1>
            <div className="mb-4 space-y-2">
                {rows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <Input
                            placeholder="App name"
                            value={row.appName}
                            onChange={(e) => updateRow(i, "appName", e.target.value)}
                            disabled={row.saved}
                        />
                        <Select
                            value={row.scheme}
                            onValueChange={(v) =>
                                updateRow(i, "scheme", v as Scheme)
                            }
                        >
                            <SelectTrigger className="w-24">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="http">http</SelectItem>
                                <SelectItem value="https">https</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            placeholder="Host (host[:port])"
                            value={row.host}
                            onChange={(e) => updateRow(i, "host", e.target.value)}
                        />
                    </div>
                ))}
            </div>
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={addRow} type="button">
                    Add row
                </Button>
                <Button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    size="sm"
                >
                    {saving ? "Saving..." : "Save"}
                </Button>
            </div>
            {message && (
                <Alert className="mt-2" variant={message === "Saved." ? "default" : "destructive"}>
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            )}
        </div>
    );
}

export default function App() {
    const queryClient = useQueryClient();
    const {
        data: initialRows,
        isLoading,
        error,
    } = useQuery({ queryKey: ["origin_servers"], queryFn: fetchOriginServers });

    if (isLoading && initialRows === undefined)
        return <div className="p-4">Loading...</div>;
    if (error)
        return (
            <div className="p-4">
                Error: {error instanceof Error ? error.message : String(error)}
            </div>
        );
    if (initialRows === undefined) return null;

    return (
        <>
            <Toaster />
            <ProxyEditor initialRows={initialRows} queryClient={queryClient} />
        </>
    );
}
