import { describe, expect, it } from "vitest";

import { fixJcoResourceTables, makeJcoReenterable } from "./jco-reenter";

const JCO_1102_FIXTURE = `
export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {
let resourceCallBorrows = [];
let scopeId = 0;
let curResourceBorrows = [];
const handleTables = [];
function trampoline5() {
 scopeId++;
 }
function trampoline6() {
 scopeId--;
 for (const { rid, handle } of resourceCallBorrows) {
 if (handleTables[rid][handle << 1] === scopeId)
 throw new TypeError('borrows not dropped for resource call');
 }
 resourceCallBorrows = [];
 }
let gen = (function* init () {
 const instanceFlags0 = new WebAssembly.Global({ value: "i32", mutable: true }, 3);
 return { ping() { return 1; }, };
})();
let promise, resolve, reject;
function runNext (value) {
 try {
 let done;
 do {
 ({ value, done } = gen.next(value));
 } while (!(value instanceof Promise) && !done);
 if (done) {
 if (resolve) return resolve(value);
 else return value;
 }
 if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
 value.then(nextVal => done ? resolve() : runNext(nextVal), reject);
 }
 catch (e) {
 if (reject) reject(e);
 else throw e;
 }
 }
 const maybeSyncReturn = runNext(null);
 return promise || maybeSyncReturn;
}
`;

describe("makeJcoReenterable", () => {
    it("stacks ResourceEnter/Exit borrow frames", () => {
        const out = makeJcoReenterable(JCO_1102_FIXTURE);
        expect(out).toContain(
            "$rcbStack.push(resourceCallBorrows); resourceCallBorrows = []; scopeId++;",
        );
        expect(out).toContain("resourceCallBorrows = $rcbStack.pop();");
        expect(out).toContain("let resourceCallBorrows = [];");
        expect(out).toMatch(
            /throw new TypeError\('borrows not dropped for resource call'\);[\s\S]*resourceCallBorrows = \$rcbStack\.pop\(\);/,
        );
    });

    it("collects instanceFlags and wraps instantiate exports", () => {
        const out = makeJcoReenterable(JCO_1102_FIXTURE);
        expect(out).toContain("$instanceFlagGlobals.push(instanceFlags0);");
        expect(out).toContain("$result.then($wrapJcoExports)");
        expect(out).toContain("$enterJcoExport");
    });

    it("is idempotent", () => {
        const once = makeJcoReenterable(JCO_1102_FIXTURE);
        expect(makeJcoReenterable(once)).toBe(once);
    });

    it("patches ResourceExitCall when JCO omits the space before '='", () => {
        // Host composite (common+db+prompt+tracers) emits `resourceCallBorrows= [];`.
        const compact = JCO_1102_FIXTURE.replace(
            "\n resourceCallBorrows = [];",
            "\n resourceCallBorrows= [];",
        );
        const out = makeJcoReenterable(compact);
        expect(out).toContain("resourceCallBorrows = $rcbStack.pop();");
    });

    it("refuses JS that is not JCO 1.10.2 instantiate output", () => {
        expect(() => makeJcoReenterable("export const x = 1;")).toThrow(
            /missing JCO 1.10.2 instantiate/,
        );
    });

    it("wraps aliased JCO export objects (namespaced + flattened share one iface)", () => {
        const aliased = JCO_1102_FIXTURE.replace(
            "return { ping() { return 1; }, };",
            `const store = { Bucket: class Bucket { constructor() { this.ok = 1; } } };
 return { store, 'host:db/store': store };`,
        );
        const src = makeJcoReenterable(aliased).replace(
            "export function instantiate",
            "function instantiate",
        );
        const instantiate = new Function(`${src}\nreturn instantiate;`)();
        const exports = instantiate(() => ({}), {});
        expect(exports.store).toBe(exports["host:db/store"]);
        expect(exports["host:db/store"].Bucket.name).not.toBe("Bucket");
        const bucket = new exports["host:db/store"].Bucket();
        expect(bucket.ok).toBe(1);
    });
});

describe("fixJcoResourceTables", () => {
    it("rebuilds definedResourceTables from resource.new bindings", () => {
        const src = `
  const definedResourceTables = [,,,,,,,,true,,,,,true,,,,,];
  const trampoline29 = rscTableCreateOwn.bind(null, handleTable8);
  const trampoline58 = rscTableCreateOwn.bind(null, handleTable16);
`;
        const out = fixJcoResourceTables(src);
        expect(out).toContain(
            "const definedResourceTables = [,,,,,,,,true,,,,,,,,true];",
        );
    });

    it("fixes the borrow free-list link read", () => {
        const src = `
  function rscTableCreateBorrow (table, rep) {
    const free = table[0] & ~T_FLAG;
    table[0] = table[free];
    table[free << 1] = scopeId;
  }
`;
        const out = fixJcoResourceTables(src);
        expect(out).toContain("table[0] = table[free << 1];");
        expect(out).not.toContain("table[0] = table[free];");
    });

    it("leaves sources without composed resource tables unchanged", () => {
        const src = "export const x = 1;";
        expect(fixJcoResourceTables(src)).toBe(src);
    });
});

describe("JCO 1.10.2 resourceCallBorrows nesting", () => {
    it("unpatched inner exit throws when the outer call still holds a borrow", () => {
        let resourceCallBorrows: Array<{ rid: number; handle: number }> = [];
        let scopeId = 0;
        const handleTables: Record<number, number[]> = { 0: [0, 0, 1, 0] };

        const enter = () => {
            scopeId++;
        };
        const exit = () => {
            scopeId--;
            for (const { rid, handle } of resourceCallBorrows) {
                if (handleTables[rid][handle << 1] === scopeId)
                    throw new TypeError("borrows not dropped for resource call");
            }
            resourceCallBorrows = [];
        };

        enter();
        resourceCallBorrows.push({ rid: 0, handle: 1 });
        enter();
        expect(() => exit()).toThrow(/borrows not dropped/);
    });

    it("stacked frames let the inner exit ignore outer borrows", () => {
        let resourceCallBorrows: Array<{ rid: number; handle: number }> = [];
        const stack: Array<typeof resourceCallBorrows> = [];
        let scopeId = 0;
        const handleTables: Record<number, number[]> = { 0: [0, 0, 1, 0] };

        const enter = () => {
            stack.push(resourceCallBorrows);
            resourceCallBorrows = [];
            scopeId++;
        };
        const exit = () => {
            scopeId--;
            for (const { rid, handle } of resourceCallBorrows) {
                if (handleTables[rid][handle << 1] === scopeId)
                    throw new TypeError("borrows not dropped for resource call");
            }
            resourceCallBorrows = stack.pop() ?? [];
        };

        enter();
        resourceCallBorrows.push({ rid: 0, handle: 1 });
        enter();
        expect(() => exit()).not.toThrow();
        expect(resourceCallBorrows).toEqual([{ rid: 0, handle: 1 }]);
        resourceCallBorrows = [];
        expect(() => exit()).not.toThrow();
    });
});
