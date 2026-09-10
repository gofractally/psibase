export function transitivePkgDependants<T>(
    name: string,
    items: T[],
    id: (item: T) => string,
    depends: (item: T) => readonly string[],
): T[] {
    const reverse = new Map<string, T[]>();
    for (const item of items) {
        for (const dep of depends(item)) {
            const list = reverse.get(dep) ?? [];
            list.push(item);
            reverse.set(dep, list);
        }
    }

    const dependants = new Map<string, T>();
    const queue = [name];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const item of reverse.get(current) ?? []) {
            const itemId = id(item);
            if (itemId !== name && !dependants.has(itemId)) {
                dependants.set(itemId, item);
                queue.push(itemId);
            }
        }
    }
    return [...dependants.values()];
}
