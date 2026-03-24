import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@shared/lib/graphql";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import { Card, CardContent } from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";
import { Separator } from "@shared/shadcn/ui/separator";
import { Toaster, toast } from "@shared/shadcn/ui/sonner";

const DEFAULT_BYPASS_PREFIXES = ["/common"];

type Scheme = "http" | "https";
type ProxyRow = {
    appName: string;
    scheme: Scheme;
    host: string;
    bypassPrefixes: string[];
    saved?: boolean;
};

type OriginServerResponse = {
    subdomain: string;
    host: string;
    tls?: Record<string, never> | null;
    bypassPrefixes?: string[];
};

function normalizeOriginRow(r: OriginServerResponse): ProxyRow {
    const scheme: Scheme = r.tls ? "https" : "http";
    let host = r.host.trim();

    const slash = host.indexOf("/");
    if (slash !== -1) host = host.slice(0, slash);
    while (host.endsWith("/")) host = host.slice(0, -1);

    return {
        appName: r.subdomain,
        scheme,
        host,
        bypassPrefixes:
            r.bypassPrefixes != null
                ? [...r.bypassPrefixes]
                : [...DEFAULT_BYPASS_PREFIXES],
        saved: true,
    };
}

async function fetchOriginServers(): Promise<ProxyRow[]> {
    const data = await graphql<{ originServers: OriginServerResponse[] }>(
        `
        {
            originServers {
                subdomain
                host
                tls {}
                bypassPrefixes
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
                    bypassPrefixes: string[];
                } = {
                    subdomain: row.appName,
                    host,
                    bypassPrefixes: [...row.bypassPrefixes],
                };
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
        initialRows.map((r) => ({
            ...r,
            bypassPrefixes: [...r.bypassPrefixes],
        })),
    );
    const [prefixDraftByRow, setPrefixDraftByRow] = useState<
        Record<number, string>
    >({});
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const addRow = () =>
        setRows((prev) => [
            ...prev,
            {
                appName: "",
                scheme: "http",
                host: "",
                bypassPrefixes: [...DEFAULT_BYPASS_PREFIXES],
                saved: false,
            },
        ]);
    type EditableField = "appName" | "scheme" | "host";
    const updateRow = (i: number, field: EditableField, value: string) =>
        setRows((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], [field]: value };
            return next;
        });

    const addBypassPrefix = (i: number) => {
        const raw = (prefixDraftByRow[i] ?? "").trim();
        if (!raw) return;
        const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
        setRows((prev) => {
            const next = [...prev];
            const list = next[i].bypassPrefixes;
            if (list.includes(withSlash)) return prev;
            next[i] = {
                ...next[i],
                bypassPrefixes: [...list, withSlash],
            };
            return next;
        });
        setPrefixDraftByRow((d) => ({ ...d, [i]: "" }));
    };

    const removeBypassPrefix = (i: number, prefixIndex: number) =>
        setRows((prev) => {
            const next = [...prev];
            next[i] = {
                ...next[i],
                bypassPrefixes: next[i].bypassPrefixes.filter(
                    (_, j) => j !== prefixIndex,
                ),
            };
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
        <div className="mx-auto max-w-3xl p-4 md:p-6">
            <div className="mb-6">
                <h1 className="text-xl font-semibold tracking-tight">
                    Reverse proxy
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                    Map subdomains to an upstream origin; path prefixes below
                    are served on-chain instead of proxied.
                </p>
            </div>
            <div className="mb-6 flex flex-col gap-4">
                {rows.map((row, i) => (
                    <Card key={i} className="gap-0 py-0 shadow-sm">
                        <CardContent className="space-y-5 p-4 sm:p-5">
                            <div className="space-y-3">
                                <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                                    Origin
                                </h2>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,11rem)_5.5rem_minmax(0,1fr)] sm:items-end">
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor={`xproxy-sub-${i}`}
                                            className="text-xs font-normal"
                                        >
                                            Subdomain
                                        </Label>
                                        <Input
                                            id={`xproxy-sub-${i}`}
                                            placeholder="e.g. tokens"
                                            value={row.appName}
                                            onChange={(e) =>
                                                updateRow(
                                                    i,
                                                    "appName",
                                                    e.target.value,
                                                )
                                            }
                                            disabled={row.saved}
                                            className="h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor={`xproxy-scheme-${i}`}
                                            className="text-xs font-normal"
                                        >
                                            Scheme
                                        </Label>
                                        <Select
                                            value={row.scheme}
                                            onValueChange={(v) =>
                                                updateRow(
                                                    i,
                                                    "scheme",
                                                    v as Scheme,
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                id={`xproxy-scheme-${i}`}
                                                className="h-9 w-full"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="http">
                                                    http
                                                </SelectItem>
                                                <SelectItem value="https">
                                                    https
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5 sm:col-span-1">
                                        <Label
                                            htmlFor={`xproxy-host-${i}`}
                                            className="text-xs font-normal"
                                        >
                                            Upstream host
                                        </Label>
                                        <Input
                                            id={`xproxy-host-${i}`}
                                            placeholder="host[:port]"
                                            value={row.host}
                                            onChange={(e) =>
                                                updateRow(
                                                    i,
                                                    "host",
                                                    e.target.value,
                                                )
                                            }
                                            className="h-9 font-mono text-sm"
                                        />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-3">
                                <div>
                                    <h2 className="text-sm font-medium">
                                        Proxy bypass paths
                                    </h2>
                                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                                        Matched prefixes are not sent to the
                                        upstream host (served locally).
                                    </p>
                                </div>
                                <div className="bg-muted/40 flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-dashed px-2.5 py-2">
                                    {row.bypassPrefixes.length === 0 ? (
                                        <span className="text-muted-foreground px-0.5 text-xs">
                                            No bypass paths — all requests will
                                            be proxied.
                                        </span>
                                    ) : (
                                        row.bypassPrefixes.map((p, j) => (
                                            <div
                                                key={`${p}-${j}`}
                                                className="bg-secondary text-secondary-foreground inline-flex max-w-full items-center gap-0.5 rounded-md border px-1 pl-2 shadow-sm"
                                            >
                                                <span className="truncate font-mono text-xs">
                                                    {p}
                                                </span>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-muted-foreground hover:text-foreground size-6 shrink-0"
                                                    onClick={() =>
                                                        removeBypassPrefix(i, j)
                                                    }
                                                    aria-label={`Remove ${p}`}
                                                >
                                                    <span
                                                        className="text-lg leading-none"
                                                        aria-hidden
                                                    >
                                                        ×
                                                    </span>
                                                </Button>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <Input
                                        placeholder="/path-prefix"
                                        value={prefixDraftByRow[i] ?? ""}
                                        onChange={(e) =>
                                            setPrefixDraftByRow((d) => ({
                                                ...d,
                                                [i]: e.target.value,
                                            }))
                                        }
                                        className="h-9 font-mono text-sm sm:max-w-xs sm:flex-1"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                addBypassPrefix(i);
                                            }
                                        }}
                                    />
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="h-9 shrink-0 sm:w-auto"
                                        onClick={() => addBypassPrefix(i)}
                                    >
                                        Add path
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={addRow}
                    type="button"
                    className="h-9"
                >
                    Add origin
                </Button>
                <Button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    size="sm"
                    className="h-9 min-w-[5.5rem]"
                >
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>
            {message && (
                <Alert
                    className="mt-2"
                    variant={message === "Saved." ? "default" : "destructive"}
                >
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
