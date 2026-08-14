// JCO 1.10.2 keeps resource-borrow lists and Canonical ABI instanceFlags
// as one frame per instantiate(). A JS hop back into the same composite
// (host:common/get-sender during post-graphql, host:db bucket.set during
// prompt) shares that frame and traps: "borrows not dropped" or wasm
// `unreachable` (MAY_ENTER cleared on the root instance).
//
// Stack the JS borrow state and force MAY_ENTER|MAY_LEAVE on every JS
// export entry so a nested call sees a fresh frame.

const FLAG_MAY_LEAVE_ENTER = 3;

const INSTANTIATE_OPEN =
    "export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {";

const INSTANTIATE_RETURN =
    /const maybeSyncReturn = runNext\(null\);\s*return promise \|\| maybeSyncReturn;/;

const HELPERS = `
const $rcbStack = [];
const $crbStack = [];
const $instanceFlagGlobals = [];
const $jcoWrapped = new WeakSet();
const $jcoWrappers = new WeakMap();
function $enterJcoExport() {
  if (typeof curResourceBorrows !== "undefined") {
    $crbStack.push(curResourceBorrows);
    curResourceBorrows = [];
  }
  const saved = $instanceFlagGlobals.map((g) => g.value);
  for (const g of $instanceFlagGlobals) g.value = ${FLAG_MAY_LEAVE_ENTER};
  return saved;
}
function $exitJcoExport(saved) {
  if (typeof curResourceBorrows !== "undefined") {
    curResourceBorrows = $crbStack.pop() ?? [];
  }
  for (let i = 0; i < saved.length; i++) $instanceFlagGlobals[i].value = saved[i];
}
function $wrapJcoFn(fn) {
  if (typeof fn !== "function") return fn;
  if ($jcoWrappers.has(fn)) return $jcoWrappers.get(fn);
  if ($jcoWrapped.has(fn)) return fn;
  const wrapped = function (...args) {
    const saved = $enterJcoExport();
    try {
      if (new.target) return Reflect.construct(fn, args, new.target);
      return fn.apply(this, args);
    } finally {
      $exitJcoExport(saved);
    }
  };
  $jcoWrappers.set(fn, wrapped);
  $jcoWrapped.add(fn);
  $jcoWrapped.add(wrapped);
  try {
    Object.setPrototypeOf(wrapped, Object.getPrototypeOf(fn));
    Object.defineProperty(wrapped, "prototype", { value: fn.prototype });
    for (const key of Object.getOwnPropertyNames(fn)) {
      if (key === "prototype" || key === "length" || key === "name") continue;
      const desc = Object.getOwnPropertyDescriptor(fn, key);
      if (desc) Object.defineProperty(wrapped, key, desc);
    }
  } catch { /* bound / native */ }
  if (fn.prototype && fn.prototype.constructor === fn) {
    for (const key of Object.getOwnPropertyNames(fn.prototype)) {
      if (key === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(fn.prototype, key);
      if (desc && typeof desc.value === "function") {
        Object.defineProperty(fn.prototype, key, { ...desc, value: $wrapJcoFn(desc.value) });
      }
    }
  }
  return wrapped;
}
function $wrapJcoExports(value, seen) {
  if (typeof value === "function") return $wrapJcoFn(value);
  if (value == null || typeof value !== "object") return value;
  const seenMap = seen || new WeakMap();
  if (seenMap.has(value)) return seenMap.get(value);
  const out = Array.isArray(value) ? [] : {};
  seenMap.set(value, out);
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "function") out[k] = $wrapJcoFn(v);
    else if (v && typeof v === "object") out[k] = $wrapJcoExports(v, seenMap);
    else out[k] = v;
  }
  return out;
}
`;

// JCO 1.10.2 has two resource-handle bugs that break composed components
// whose subcomponents define resources (our tracer-wrapped host:db bucket):
//
// 1. `definedResourceTables` is mis-indexed: the table id recorded for a
//    subcomponent-defined resource can point at a nonexistent table, so
//    `resourceTransferBorrow` creates a borrow *handle* instead of passing
//    the *rep* into the defining subcomponent (the canonical ABI requires
//    the rep). The callee then uses that handle as if it were the rep,
//    which only works while the two tables coincidentally assign the same
//    index — and silently reads rep=0 once they diverge.
//    Fix: any table with a `rscTableCreateOwn.bind(null, handleTableN)`
//    binding is a `canon resource.new` target, which only the defining
//    instance may have. Rebuild the flags from that ground truth.
//
// 2. `rscTableCreateBorrow` reads the free-list link from `table[free]`;
//    `rscTableRemove` stores it at `table[handle << 1]` (and
//    `rscTableCreateOwn` correctly reads `table[free << 1]`). Reusing a
//    freed slot for a borrow therefore corrupts the free-list head.
export function fixJcoResourceTables(jsSource: string): string {
    let src = jsSource.replace(
        "table[0] = table[free];",
        "table[0] = table[free << 1];",
    );

    const definedTids = new Set<number>();
    for (const m of src.matchAll(
        /rscTableCreateOwn\.bind\(null, handleTable(\d+)\)/g,
    )) {
        definedTids.add(Number(m[1]));
    }
    const declRe = /const definedResourceTables = \[[^\]]*\];/;
    if (declRe.test(src)) {
        const max = Math.max(-1, ...definedTids);
        const literal = Array.from({ length: max + 1 }, (_, i) =>
            definedTids.has(i) ? "true" : "",
        ).join(",");
        src = src.replace(
            declRe,
            `const definedResourceTables = [${literal}];`,
        );
    }
    return src;
}

export function makeJcoReenterable(jsSource: string): string {
    if (jsSource.includes("$enterJcoExport")) {
        return jsSource;
    }
    if (!jsSource.includes(INSTANTIATE_OPEN)) {
        throw new Error(
            "jco-reenter: generated JS is missing JCO 1.10.2 instantiate(); cannot patch re-entry",
        );
    }
    if (!INSTANTIATE_RETURN.test(jsSource)) {
        throw new Error(
            "jco-reenter: generated JS is missing JCO 1.10.2 instantiate return; cannot patch re-entry",
        );
    }

    let src = jsSource.replace(INSTANTIATE_OPEN, `${INSTANTIATE_OPEN}\n${HELPERS}`);

    src = src.replace(
        /const (instanceFlags\d+) = new WebAssembly\.Global\(([\s\S]*?)\);/g,
        "const $1 = new WebAssembly.Global($2); $instanceFlagGlobals.push($1);",
    );

    if (src.includes("let resourceCallBorrows = [];")) {
        const entered = src.replace(
            /function (trampoline\d+)\(\) \{\s*scopeId\+\+;\s*\}/g,
            "function $1() {\n $rcbStack.push(resourceCallBorrows); resourceCallBorrows = []; scopeId++;\n }",
        );
        if (entered === src) {
            throw new Error(
                "jco-reenter: resourceCallBorrows is present but ResourceEnterCall trampolines were not patched",
            );
        }
        src = entered.replace(
            /(throw new TypeError\('borrows not dropped for resource call'\);\s*\}\s*)resourceCallBorrows\s*=\s*\[\];/g,
            "$1resourceCallBorrows = $rcbStack.pop();",
        );
        if (!src.includes("resourceCallBorrows = $rcbStack.pop();")) {
            throw new Error(
                "jco-reenter: resourceCallBorrows is present but ResourceExitCall trampolines were not patched",
            );
        }
    }

    src = src.replace(
        INSTANTIATE_RETURN,
        `const maybeSyncReturn = runNext(null);
  const $result = promise || maybeSyncReturn;
  return $result && typeof $result.then === "function"
    ? $result.then($wrapJcoExports)
    : $wrapJcoExports($result);`,
    );

    return src;
}
