export const pressureUnavailableMessage =
    "Storage pressure information is unavailable for this database engine.";

export function databaseMemoryNotice(
    bytes: number | null | undefined,
    attribution: "file-backed" | "unavailable" | undefined,
) {
    if (bytes == null || attribution === "unavailable")
        return "Database memory attribution is unavailable on this platform.";
    return "Database usage includes file-backed mappings. Anonymous allocations are included in unclassified memory.";
}
