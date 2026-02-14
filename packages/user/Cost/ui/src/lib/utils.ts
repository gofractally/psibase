export function formatDate(input: string | number): string {
    const date = new Date(input);
    return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

export function debounce<T extends (...args: unknown[]) => unknown>(
    cb: T,
    wait: number,
): (...args: Parameters<T>) => void {
    let h: NodeJS.Timeout;
    const callable = (...args: Parameters<T>) => {
        clearTimeout(h);
        h = setTimeout(() => cb(...args), wait);
    };
    return callable as T;
}

export const modifyUrlParams = (
    url: string,
    params: { [key: string]: string },
): string => {
    const urlObject = new URL(url);

    const parsObject = new URLSearchParams(urlObject.search);

    Object.entries(params).forEach(([key, value]) => {
        parsObject.set(key, value);
    });

    urlObject.search = parsObject.toString();

    return urlObject.toString();
};
