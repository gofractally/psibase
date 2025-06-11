import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

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
