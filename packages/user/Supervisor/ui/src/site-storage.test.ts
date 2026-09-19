import { afterEach, describe, expect, it } from "vitest";

import {
    persistLocalStorageToSiteCookies,
    restoreLocalStorageFromSiteCookies,
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

    it("round-trips localStorage through site cookies", () => {
        localStorage.setItem("logged_in_user", "theodore");
        persistLocalStorageToSiteCookies();
        localStorage.clear();
        expect(localStorage.getItem("logged_in_user")).toBeNull();
        restoreLocalStorageFromSiteCookies();
        expect(localStorage.getItem("logged_in_user")).toBe("theodore");
    });
});
