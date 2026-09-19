function isUselessMessage(message: string): boolean {
    return (
        message.includes("[object Object]") ||
        message.includes("(see error.payload)") ||
        /^\{"name":"[A-Za-z]+"\}$/.test(message)
    );
}

function formatUnknown(error: unknown, depth: number): string {
    if (depth > 8 || error == null) {
        return "";
    }
    if (typeof error === "string") {
        return error.trim();
    }
    if (typeof error === "number" || typeof error === "boolean") {
        return String(error);
    }
    if (Array.isArray(error)) {
        return error
            .map((item) => formatUnknown(item, depth + 1))
            .filter((item) => item.length > 0)
            .join(": ");
    }
    if (typeof error === "object") {
        const rec = error as Record<string, unknown>;
        if ("payload" in rec && rec.payload !== undefined) {
            const fromPayload = formatUnknown(rec.payload, depth + 1);
            if (fromPayload) {
                return fromPayload;
            }
        }
        if (typeof rec.tag === "string" && "val" in rec) {
            const inner = formatUnknown(rec.val, depth + 1);
            return inner ? `${rec.tag}: ${inner}` : rec.tag;
        }
        if (typeof rec.message === "string") {
            const message = rec.message.trim();
            if (message && !isUselessMessage(message)) {
                return message;
            }
        }
        try {
            const json = JSON.stringify(error);
            if (
                json &&
                json !== "{}" &&
                !/^\{"name":"[A-Za-z]+"\}$/.test(json)
            ) {
                return json;
            }
        } catch {
            // fall through
        }
    }
    return "";
}

/** Gets a string message from the error */
export const parseError = (error: unknown): string => {
    const formatted = formatUnknown(error, 0);
    if (formatted) {
        return formatted;
    }
    console.error("Unrecognised error", error);
    const fallback = String(error);
    if (
        !fallback ||
        fallback === "[object Object]" ||
        isUselessMessage(fallback)
    ) {
        return "Unknown plugin error";
    }
    return fallback;
};
