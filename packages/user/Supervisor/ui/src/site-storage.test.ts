import { afterEach, describe, expect, it } from "vitest";

import {
    persistLocalStorageToSiteCookies,
    restoreLocalStorageFromSiteCookies,
    shouldPersistKey,
} from "./site-storage";

describe("site-storage", () => {
    afterEach(() => {
        localStorage.clear();
        document.cookie.split(";").forEach((part) => {
            const name = part.split("=")[0]?.trim();
            if (name) {
                document.cookie = `${name}=; Max-Age=0; Path=/`;
            }
        });
    });

    it("round-trips login state and omits key material", () => {
        localStorage.setItem("cid:non-trx:accounts:logged_in_user:homepage", "theodore");
        localStorage.setItem("cid:non-trx:webcrypto:keys:abc", "SECRET");
        persistLocalStorageToSiteCookies();
        localStorage.clear();
        restoreLocalStorageFromSiteCookies();
        expect(
            localStorage.getItem("cid:non-trx:accounts:logged_in_user:homepage"),
        ).toBe("theodore");
        expect(localStorage.getItem("cid:non-trx:webcrypto:keys:abc")).toBeNull();
    });

    it("keeps the previous backup when a dump is over budget", () => {
        localStorage.setItem("cid:non-trx:accounts:logged_in_user:homepage", "theodore");
        persistLocalStorageToSiteCookies();
        localStorage.setItem("cid:non-trx:accounts:logged_in_user:homepage", "x".repeat(80_000));
        persistLocalStorageToSiteCookies();
        localStorage.clear();
        restoreLocalStorageFromSiteCookies();
        expect(
            localStorage.getItem("cid:non-trx:accounts:logged_in_user:homepage"),
        ).toBe("theodore");
    });

    it("shouldPersistKey rejects keys and query tokens", () => {
        expect(shouldPersistKey("cid:non-trx:webcrypto:keys:ab")).toBe(false);
        expect(shouldPersistKey("cid:non-trx:host:query_tokens-theodore:homepage")).toBe(
            false,
        );
        expect(shouldPersistKey("cid:non-trx:accounts:logged_in_user:homepage")).toBe(
            true,
        );
    });
});
