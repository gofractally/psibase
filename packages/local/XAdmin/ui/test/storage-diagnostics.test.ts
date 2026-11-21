import assert from "node:assert/strict";
import test from "node:test";
import { databaseMemoryNotice, pressureUnavailableMessage } from "../src/lib/storage-diagnostics.ts";

test("unknown storage memory stays unavailable while real zero stays measured", () => {
    assert.match(databaseMemoryNotice(null, "unavailable"), /unavailable/);
    assert.match(databaseMemoryNotice(undefined, undefined), /unavailable/);
    assert.match(databaseMemoryNotice(0, "file-backed"), /file-backed/);
    assert.doesNotMatch(databaseMemoryNotice(0, "file-backed"), /unavailable/);
});

test("the pressure status explains unavailable information", () => {
    assert.match(pressureUnavailableMessage, /unavailable/);
    assert.doesNotMatch(pressureUnavailableMessage, /healthy|lock database/);
});
