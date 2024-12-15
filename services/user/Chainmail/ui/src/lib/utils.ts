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

export function debounce<T extends (...args: any[]) => any>(
    cb: T,
    wait: number,
) {
    let h: any;
    const callable = (...args: any) => {
        clearTimeout(h);
        h = setTimeout(() => cb(...args), wait);
    };
    return <T>(<any>callable);
}

export const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

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
