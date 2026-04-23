export function kebabToCamel(s: string): string {
    return s.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function kebabToPascal(s: string): string {
    if (s.length === 0) return s;
    const camel = kebabToCamel(s);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function camelToKebab(s: string): string {
    return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
