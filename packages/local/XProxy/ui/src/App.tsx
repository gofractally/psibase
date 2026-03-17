import { siblingUrl } from "@psibase/common-lib";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type ProxyRow = { appName: string; origin: string; saved?: boolean };

async function fetchOriginServers(): Promise<ProxyRow[]> {
    const url = siblingUrl(null, "x-proxy", "/origin_servers");
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 401) throw new Error("Not authorized");
        throw new Error(await res.text());
    }
    const data: { subdomain: string; host: string }[] = await res.json();
    return data.map((r) => ({ appName: r.subdomain, origin: r.host, saved: true }));
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
        if (!regRes.ok) throw new Error(`register_server: ${await regRes.text()}`);

        const originRes = await fetch(setOriginUrl, {
            ...opts,
            method: "POST",
            body: JSON.stringify({ subdomain: row.appName, host: row.origin }),
        });
        if (!originRes.ok) throw new Error(`set_origin_server: ${await originRes.text()}`);
    }
}

export default function App() {
    const queryClient = useQueryClient();
    const { data: initialRows, isLoading, error } = useQuery({ queryKey: ["origin_servers"], queryFn: fetchOriginServers });
    const [rows, setRows] = useState<ProxyRow[]>([]);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (initialRows !== undefined && rows.length === 0)
            setRows(initialRows.map((r) => ({ ...r })));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed when initial load completes
    }, [initialRows]);

    const addRow = () => setRows((prev) => [...prev, { appName: "", origin: "", saved: false }]);
    const updateRow = (i: number, field: keyof ProxyRow, value: string) =>
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
            await queryClient.invalidateQueries({ queryKey: ["origin_servers"] });
            setMessage("Saved.");
        } catch (e) {
            setMessage(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    if (isLoading && rows.length === 0) return <div className="p-4">Loading...</div>;
    if (error) return <div className="p-4">Error: {error instanceof Error ? error.message : String(error)}</div>;

    return (
        <div className="p-4 max-w-2xl">
            <h1 className="text-xl font-medium mb-4">Reverse proxy</h1>
            <div className="space-y-2 mb-4">
                {rows.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center">
                        <input
                            className="border-input placeholder:text-muted-foreground flex-1 rounded border bg-transparent px-2 py-1 text-foreground dark:bg-input/30 disabled:opacity-60 disabled:cursor-not-allowed"
                            placeholder="App name"
                            value={row.appName}
                            onChange={(e) => updateRow(i, "appName", e.target.value)}
                            disabled={row.saved}
                        />
                        <input
                            className="border-input placeholder:text-muted-foreground flex-1 rounded border bg-transparent px-2 py-1 text-foreground dark:bg-input/30"
                            placeholder="Origin server"
                            value={row.origin}
                            onChange={(e) => updateRow(i, "origin", e.target.value)}
                        />
                    </div>
                ))}
            </div>
            <div className="flex gap-2">
                <button type="button" className="border rounded px-3 py-1" onClick={addRow}>
                    Add row
                </button>
                <button type="button" className="border rounded px-3 py-1 bg-primary text-primary-foreground" onClick={onSave} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                </button>
            </div>
            {message && <p className="mt-2 text-sm">{message}</p>}
        </div>
    );
}
