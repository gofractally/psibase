import { useEffect, useState } from "react";

import { chainIdPromise } from "./utils";

export function LocalStorageManager() {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [ids, setIds] = useState<string[]>([]);
    const [currentChainId, setCurrentChainId] = useState<string | null>(null);

    const getUniqueIds = (): string[] => {
        const keys = Object.keys(localStorage);
        const uniqueIds = new Set<string>();

        keys.forEach((key) => {
            const parts = key.split(":");
            if (parts.length >= 1) {
                uniqueIds.add(parts[0]);
            }
        });

        return Array.from(uniqueIds).sort();
    };

    const toggleIdSelection = (id: string): void => {
        setSelectedIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const deleteSelectedIds = (): void => {
        const keysToDelete = Object.keys(localStorage).filter((key) => {
            const parts = key.split(":");
            return parts.length >= 1 && selectedIds.has(parts[0]);
        });

        keysToDelete.forEach((key) => localStorage.removeItem(key));
        setSelectedIds(new Set());
        setIds(getUniqueIds());
    };

    const selectAll = (): void => {
        const idsToSelect = ids.filter((id) => id !== currentChainId);
        setSelectedIds(new Set(idsToSelect));
    };

    const selectNone = (): void => {
        setSelectedIds(new Set());
    };

    useEffect(() => {
        setIds(getUniqueIds());
    }, []);

    useEffect(() => {
        chainIdPromise.then((chainId) => {
            setCurrentChainId(chainId);
        });
    }, []);

    return (
        <div style={{ padding: "20px", fontFamily: "monospace" }}>
            <div style={{ marginBottom: "20px", display: "flex", gap: "8px" }}>
                <button
                    onClick={selectAll}
                    style={{
                        padding: "8px 16px",
                        background: "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                    }}
                >
                    Select All Except Current Chain
                </button>
                <button
                    onClick={selectNone}
                    style={{
                        padding: "8px 16px",
                        background: "#6c757d",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                    }}
                >
                    Select None
                </button>
                <button
                    onClick={deleteSelectedIds}
                    disabled={selectedIds.size === 0}
                    style={{
                        padding: "8px 16px",
                        background: "#dc3545",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor:
                            selectedIds.size === 0 ? "not-allowed" : "pointer",
                    }}
                >
                    Delete Selected ({selectedIds.size})
                </button>
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
                {ids.map((id) => (
                    <label
                        key={id}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "8px",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            cursor: "pointer",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={selectedIds.has(id)}
                            onChange={() => toggleIdSelection(id)}
                        />
                        <span
                            style={{
                                fontFamily: "monospace",
                                color:
                                    currentChainId === id
                                        ? "#dc3545"
                                        : "inherit",
                            }}
                        >
                            {id}
                            {currentChainId === id && (
                                <span
                                    style={{
                                        color: "#dc3545",
                                        marginLeft: "8px",
                                        fontWeight: "bold",
                                    }}
                                >
                                    (current chain)
                                </span>
                            )}
                        </span>
                    </label>
                ))}
            </div>
            {ids.length === 0 && <p>No localStorage keys found</p>}
        </div>
    );
}
