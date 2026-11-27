// What the views of the sign-in page share.
import { type GuestSession } from "../guest-session";
import { type Network } from "./device";
import { type Unlocked } from "./passkey";

export type View = "welcome" | "fallback" | "account" | "manage" | "working" | "done" | "unsupported";

export interface PageContext {
    session: GuestSession;
    /** The app the visitor is on their way to, and the page in it. */
    app: string;
    path: string;
    rootName: string;
    net: Network;
    $: <T extends HTMLElement>(id: string) => T;
    show: (view: View) => void;
    working: (title: string, detail?: string) => void;
    /**
     * Asks for the passkey this browser signed in with. `adding` names an
     * account the action is about to create or bring back: it is written
     * into the passkey in the same prompt. The caller wipes the result when
     * its action is finished.
     */
    unlock: (why: string, detail?: string, adding?: string) => Promise<Unlocked>;
    /**
     * Leaves for the app: as `account`, or as a guest. `signedIn` says the
     * account was just signed in to the app and need not be again.
     */
    enterApp: (account?: string, signedIn?: boolean) => Promise<void>;
    isCancelled: (e: unknown) => boolean;
    /** Opens another step of this page, keeping the destination. */
    go: (step: "account" | "manage", extra?: Record<string, string>) => void;
}

/** A small element builder for the views that are made in code. */
export const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: { class?: string; text?: string; type?: string } = {},
    ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.setAttribute("type", props.type);
    node.append(...children);
    return node;
};

export const linkButton = (label: string, run: () => void) => {
    const b = el("button", { class: "si-link", text: label, type: "button" });
    b.addEventListener("click", run);
    return b;
};

/** Fills a line of links, separated by dots. */
export const setLinks = (
    line: HTMLElement,
    links: { label: string; run: () => void }[],
) => {
    line.textContent = "";
    line.hidden = links.length === 0;
    links.forEach((link, i) => {
        if (i) line.append(" · ");
        line.append(linkButton(link.label, link.run));
    });
};

/** Sends a transaction the node prepared, and waits until it is applied. */
export const pushPrepared = async (transactOrigin: string, hex: string) => {
    const bytes = Uint8Array.from(hex.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
    const res = await fetch(`${transactOrigin}/push_transaction?wait_for=applied`, {
        method: "POST",
        headers: {
            "Content-Type": "application/octet-stream",
            Accept: "application/json",
        },
        body: new Blob([bytes.buffer as ArrayBuffer]),
    });
    const trace = res.ok
        ? ((await res.json()) as { error?: string | null })
        : { error: await res.text() };
    if (trace.error) throw new Error(trace.error);
};

export const NAME_RULE = /^[a-z][a-z0-9-]{7,9}$/;
export const ANY_NAME_RULE = /^[a-z][a-z0-9-]{0,9}$/;
