export function camelCase(str: string): string {
    return str
        .split(/[-_ ]+/)
        .map((w, i) =>
            i === 0
                ? w.toLowerCase()
                : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
        .join("");
}
