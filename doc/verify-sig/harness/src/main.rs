//! Times the VerifySig service two ways with identical inputs:
//!   * the production VerifySig.wasm under wasmtime (configured like the node), and
//!   * the same service source built as a native shared library.
//!
//! usage: verify-bench <VerifySig.wasm> <libVerifySig.dylib>... -- <action.bin>... [-n iterations]

use std::ffi::{c_char, c_void, CString};
use std::time::{Duration, Instant};
use wasmtime::*;

struct Host {
    action: Vec<u8>,
    abort: Option<String>,
}

// ── wasm ────────────────────────────────────────────────────────────────────

fn engine() -> Engine {
    let mut c = Config::new();
    // Mirrors pzwt_engine_new for the features VerifySig uses.
    c.cranelift_nan_canonicalization(true);
    c.relaxed_simd_deterministic(true);
    c.wasm_simd(true);
    c.wasm_bulk_memory(true);
    c.wasm_multi_value(true);
    c.wasm_threads(false);
    c.wasm_tail_call(false);
    c.shared_memory(false);
    c.wasm_multi_memory(false);
    c.wasm_memory64(false);
    // Off in the node today. VERIFY_BENCH_WIDE=1 turns it on for comparison.
    c.wasm_wide_arithmetic(std::env::var("VERIFY_BENCH_WIDE").is_ok());
    c.wasm_gc(false);
    c.collector(Collector::Null);
    Engine::new(&c).unwrap()
}

fn linker(engine: &Engine) -> Linker<Host> {
    let mut l = Linker::new(engine);
    l.func_wrap(
        "env",
        "abortMessage",
        |mut caller: Caller<'_, Host>, ptr: u32, len: u32| -> Result<()> {
            let mem = caller.get_export("memory").unwrap().into_memory().unwrap();
            let mut buf = vec![0u8; len as usize];
            mem.read(&caller, ptr as usize, &mut buf)?;
            let msg = String::from_utf8_lossy(&buf).into_owned();
            caller.data_mut().abort = Some(msg);
            Err(Error::msg("service aborted"))
        },
    )
    .unwrap();
    l.func_wrap(
        "env",
        "getResult",
        |mut caller: Caller<'_, Host>, dest: u32, size: u32, offset: u32| -> Result<u32> {
            let mem = caller.get_export("memory").unwrap().into_memory().unwrap();
            let (data, host) = mem.data_and_store_mut(&mut caller);
            let total = host.action.len();
            let (dest, size, offset) = (dest as usize, size as usize, offset as usize);
            if dest.checked_add(size).map_or(true, |e| e > data.len()) {
                return Err(Error::msg("host pointer is outside linear memory"));
            }
            if offset < total && size > 0 {
                let n = size.min(total - offset);
                data[dest..dest + n].copy_from_slice(&host.action[offset..offset + n]);
            }
            Ok(total as u32)
        },
    )
    .unwrap();
    l.func_wrap("env", "getCurrentAction", |caller: Caller<'_, Host>| -> u32 {
        caller.data().action.len() as u32
    })
    .unwrap();
    l.func_wrap("env", "writeConsole", |_: Caller<'_, Host>, _: u32, _: u32| {})
        .unwrap();
    l
}

const SERVICE: u64 = 0x1234; // value is not inspected by VerifySig

/// One verification on a fresh instance: instantiate, `start`, `called`.
fn wasm_fresh(engine: &Engine, pre: &InstancePre<Host>, action: &[u8]) -> Option<String> {
    let mut store = Store::new(engine, Host { action: action.to_vec(), abort: None });
    let inst = pre.instantiate(&mut store).unwrap();
    inst.get_typed_func::<u64, ()>(&mut store, "start").unwrap().call(&mut store, SERVICE).unwrap();
    let called = inst.get_typed_func::<(u64, u64), ()>(&mut store, "called").unwrap();
    match called.call(&mut store, (SERVICE, 0)) {
        Ok(()) => None,
        Err(e) => Some(store.data_mut().abort.take().unwrap_or_else(|| format!("trap: {e}"))),
    }
}

/// A long-lived instance: `start` once, then `called` for every verification.
struct WasmReused {
    store: Store<Host>,
    called: TypedFunc<(u64, u64), ()>,
}

impl WasmReused {
    fn new(engine: &Engine, pre: &InstancePre<Host>) -> Self {
        let mut store = Store::new(engine, Host { action: Vec::new(), abort: None });
        let inst = pre.instantiate(&mut store).unwrap();
        inst.get_typed_func::<u64, ()>(&mut store, "start").unwrap().call(&mut store, SERVICE).unwrap();
        let called = inst.get_typed_func::<(u64, u64), ()>(&mut store, "called").unwrap();
        WasmReused { store, called }
    }
    fn verify(&mut self, action: &[u8]) -> Option<String> {
        self.store.data_mut().action = action.to_vec();
        match self.called.call(&mut self.store, (SERVICE, 0)) {
            Ok(()) => None,
            Err(e) => Some(self.store.data_mut().abort.take().unwrap_or_else(|| format!("trap: {e}"))),
        }
    }
}

/// A long-lived instance whose linear memory is restored from a post-init
/// snapshot before every call, so each call starts from identical memory.
/// (Mutable globals are not restored here; a call that returns normally
/// leaves the stack pointer where it found it.)
struct WasmRestored {
    inner: WasmReused,
    memory: Memory,
    snapshot: Vec<u8>,
}

impl WasmRestored {
    fn new(engine: &Engine, pre: &InstancePre<Host>) -> Self {
        let mut store = Store::new(engine, Host { action: Vec::new(), abort: None });
        let inst = pre.instantiate(&mut store).unwrap();
        inst.get_typed_func::<u64, ()>(&mut store, "start").unwrap().call(&mut store, SERVICE).unwrap();
        let called = inst.get_typed_func::<(u64, u64), ()>(&mut store, "called").unwrap();
        let memory = inst.get_memory(&mut store, "memory").unwrap();
        let snapshot = memory.data(&store).to_vec();
        WasmRestored { inner: WasmReused { store, called }, memory, snapshot }
    }
    fn verify(&mut self, action: &[u8]) -> Option<String> {
        let data = self.memory.data_mut(&mut self.inner.store);
        // Memory may have grown during a call; the snapshot covers the initial size.
        data[..self.snapshot.len()].copy_from_slice(&self.snapshot);
        self.inner.verify(action)
    }
}

/// Instance creation and `start` only, no verification.
fn wasm_instantiate_only(engine: &Engine, pre: &InstancePre<Host>) -> Option<String> {
    let mut store = Store::new(engine, Host { action: Vec::new(), abort: None });
    let inst = pre.instantiate(&mut store).unwrap();
    inst.get_typed_func::<u64, ()>(&mut store, "start").unwrap().call(&mut store, SERVICE).unwrap();
    None
}

// ── native ──────────────────────────────────────────────────────────────────

#[repr(C)]
struct PsibaseHost {
    ctx: *mut c_void,
    get_current_action: unsafe extern "C" fn(*mut c_void) -> u32,
    get_result: unsafe extern "C" fn(*mut c_void, *mut c_char, u32, u32) -> u32,
    write_console: unsafe extern "C" fn(*mut c_void, *const c_char, u32),
    abort_message: unsafe extern "C" fn(*mut c_void, *const c_char, u32),
}

unsafe extern "C" fn n_get_current_action(ctx: *mut c_void) -> u32 {
    (*(ctx as *mut Host)).action.len() as u32
}
unsafe extern "C" fn n_get_result(ctx: *mut c_void, dest: *mut c_char, size: u32, offset: u32) -> u32 {
    let host = &*(ctx as *mut Host);
    let (total, size, offset) = (host.action.len(), size as usize, offset as usize);
    if offset < total && size > 0 {
        let n = size.min(total - offset);
        std::ptr::copy_nonoverlapping(host.action.as_ptr().add(offset), dest as *mut u8, n);
    }
    total as u32
}
unsafe extern "C" fn n_write_console(_: *mut c_void, _: *const c_char, _: u32) {}
unsafe extern "C" fn n_abort_message(ctx: *mut c_void, msg: *const c_char, len: u32) {
    let bytes = std::slice::from_raw_parts(msg as *const u8, len as usize);
    (*(ctx as *mut Host)).abort = Some(String::from_utf8_lossy(bytes).into_owned());
}

struct Native {
    called: unsafe extern "C" fn(*const PsibaseHost, u64, u64) -> i32,
}

impl Native {
    fn load(path: &str) -> (Native, Duration) {
        unsafe {
            let cpath = CString::new(path).unwrap();
            let t = Instant::now();
            let lib = libc::dlopen(cpath.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            assert!(!lib.is_null(), "dlopen {path} failed");
            let sym = |name: &str| {
                let n = CString::new(name).unwrap();
                let p = libc::dlsym(lib, n.as_ptr());
                assert!(!p.is_null(), "missing symbol {name}");
                p
            };
            let prestart: unsafe extern "C" fn() = std::mem::transmute(sym("psibase_native_prestart"));
            prestart();
            let called = std::mem::transmute(sym("psibase_native_called"));
            (Native { called }, t.elapsed())
        }
    }
    fn verify(&self, action: &[u8]) -> Option<String> {
        let mut host = Host { action: action.to_vec(), abort: None };
        let table = PsibaseHost {
            ctx: &mut host as *mut Host as *mut c_void,
            get_current_action: n_get_current_action,
            get_result: n_get_result,
            write_console: n_write_console,
            abort_message: n_abort_message,
        };
        match unsafe { (self.called)(&table, SERVICE, 0) } {
            0 => None,
            1 => Some(host.abort.take().unwrap_or_default()),
            s => Some(format!("exception (status {s})")),
        }
    }
}

// ── timing ──────────────────────────────────────────────────────────────────

struct Stats {
    min: f64,
    median: f64,
    mean: f64,
}

fn time<F: FnMut() -> Option<String>>(n: usize, mut f: F) -> (Stats, Option<String>) {
    for _ in 0..n.min(20) {
        f(); // warm up
    }
    let mut samples = Vec::with_capacity(n);
    let mut outcome = None;
    for _ in 0..n {
        let t = Instant::now();
        let r = f();
        samples.push(t.elapsed().as_secs_f64() * 1e6);
        outcome = r;
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let stats = Stats {
        min: samples[0],
        median: samples[n / 2],
        mean: samples.iter().sum::<f64>() / n as f64,
    };
    (stats, outcome)
}

/// Differential test: runs every case in `cases` through two verify-sig wasm
/// modules and checks each against its expectation and against the other.
///
/// usage: verify-bench --diff <canonical.wasm> <either-s.wasm> <cases.bin>
fn diff(canonical: &str, plain: &str, cases: &str) {
    use std::collections::BTreeMap;
    let engine = engine();
    let load = |path: &str| {
        let module = Module::new(&engine, std::fs::read(path).unwrap()).unwrap();
        linker(&engine).instantiate_pre(&module).unwrap()
    };
    let (a, b) = (load(canonical), load(plain));
    let data = std::fs::read(cases).unwrap();
    let mut pos = 0usize;
    // per category: [cases, canonical accepted, plain accepted, canonical != expected,
    //                plain != expected, the two disagree where they should agree]
    let mut stats: BTreeMap<String, [u64; 6]> = BTreeMap::new();
    let mut shown = 0;
    let category = |label: &str| -> String {
        if let Some(rest) = label.strip_prefix("wycheproof-") {
            let curve = rest.split('-').next().unwrap();
            let high = if label.ends_with("-highS") { "-highS" } else { "" };
            format!("wycheproof-{curve}{high}")
        } else {
            label.to_string()
        }
    };
    while pos < data.len() {
        let n = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
        let action = &data[pos + 4..pos + 4 + n];
        pos += 4 + n;
        let (want_a, want_b) = (data[pos], data[pos + 1]);
        let l = u16::from_le_bytes(data[pos + 2..pos + 4].try_into().unwrap()) as usize;
        let label = std::str::from_utf8(&data[pos + 4..pos + 4 + l]).unwrap().to_string();
        pos += 4 + l;

        let ra = wasm_fresh(&engine, &a, action);
        let rb = wasm_fresh(&engine, &b, action);
        let (acc_a, acc_b) = (ra.is_none() as u8, rb.is_none() as u8);
        let e = stats.entry(category(&label)).or_default();
        e[0] += 1;
        e[1] += acc_a as u64;
        e[2] += acc_b as u64;
        let bad_a = want_a != 2 && acc_a != want_a;
        let bad_b = want_b != 2 && acc_b != want_b;
        // The two may only differ where their expectations differ (high-S).
        let disagree = want_a == want_b && acc_a != acc_b;
        e[3] += bad_a as u64;
        e[4] += bad_b as u64;
        e[5] += disagree as u64;
        if (bad_a || bad_b || disagree) && shown < 2000 {
            shown += 1;
            // The claim's key starts 4 bytes before the id-ecPublicKey identifier.
            const OID: [u8; 9] = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
            let key = action
                .windows(7)
                .position(|w| w == &OID[2..])
                .map(|i| i.saturating_sub(6))
                .map(|i| action[i..(i + 30).min(action.len())].iter().map(|b| format!("{b:02x}")).collect::<String>())
                .unwrap_or_default();
            println!(
                "MISMATCH {label}: canonical={} ({}) either-s={} ({}) expected {want_a}/{want_b} key={key}",
                acc_a, ra.unwrap_or_default(), acc_b, rb.unwrap_or_default()
            );
        }
    }
    println!("{:<44} {:>7} {:>9} {:>9} {:>8} {:>8} {:>9}", "category", "cases", "canon-acc", "plain-acc", "canon-x", "plain-x", "disagree");
    let mut total = [0u64; 6];
    for (k, v) in &stats {
        println!("{:<44} {:>7} {:>9} {:>9} {:>8} {:>8} {:>9}", k, v[0], v[1], v[2], v[3], v[4], v[5]);
        for i in 0..6 {
            total[i] += v[i];
        }
    }
    println!("{:<44} {:>7} {:>9} {:>9} {:>8} {:>8} {:>9}", "TOTAL", total[0], total[1], total[2], total[3], total[4], total[5]);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--diff") {
        return diff(&args[1], &args[2], &args[3]);
    }
    let mut n = 2000usize;
    let mut wasm_path = None;
    let mut libs = Vec::new();
    let mut vectors = Vec::new();
    let mut after_sep = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-n" => {
                n = args[i + 1].parse().unwrap();
                i += 1;
            }
            "--" => after_sep = true,
            a if after_sep => vectors.push(a.to_string()),
            a if wasm_path.is_none() => wasm_path = Some(a.to_string()),
            a => libs.push(a.to_string()),
        }
        i += 1;
    }
    let wasm_path = wasm_path.expect("wasm path");

    let engine = engine();
    let bytes = std::fs::read(&wasm_path).unwrap();
    let t = Instant::now();
    let module = Module::new(&engine, &bytes).unwrap();
    let compile = t.elapsed();
    let pre = linker(&engine).instantiate_pre(&module).unwrap();
    println!("wasm: {} ({} bytes), cranelift compile {:.1} ms", wasm_path, bytes.len(), compile.as_secs_f64() * 1e3);

    let natives: Vec<(String, Native)> = libs
        .iter()
        .map(|p| {
            let (lib, load) = Native::load(p);
            println!("native: {} load+prestart {:.1} ms", p, load.as_secs_f64() * 1e3);
            (p.clone(), lib)
        })
        .collect();

    println!("\niterations per case: {n}; times in microseconds per verification");
    println!("{:<24} {:<34} {:>9} {:>9} {:>9}  {}", "vector", "path", "min", "median", "mean", "outcome");
    {
        let (s, _) = time(n, || wasm_instantiate_only(&engine, &pre));
        println!("{:<24} {:<34} {:>9.1} {:>9.1} {:>9.1}", "(no input)", "wasm instantiate + start only", s.min, s.median, s.mean);
    }
    for v in &vectors {
        let action = std::fs::read(v).unwrap();
        let name = std::path::Path::new(v).file_stem().unwrap().to_string_lossy().into_owned();
        let show = |path: &str, (s, o): (Stats, Option<String>)| -> f64 {
            println!(
                "{:<24} {:<34} {:>9.1} {:>9.1} {:>9.1}  {}",
                name, path, s.min, s.median, s.mean,
                o.map_or("accepted".to_string(), |m| format!("rejected: {m}"))
            );
            s.median
        };
        let w = show("wasm (wasmtime, fresh instance)", time(n, || wasm_fresh(&engine, &pre, &action)));
        // A rejected call traps mid-function, so only reuse an instance for accepted inputs.
        if wasm_fresh(&engine, &pre, &action).is_none() {
            let mut reused = WasmReused::new(&engine, &pre);
            show("wasm (wasmtime, reused instance)", time(n, || reused.verify(&action)));
            let mut restored = WasmRestored::new(&engine, &pre);
            let label = format!("wasm (reused + restore {} KB)", restored.snapshot.len() / 1024);
            show(&label, time(n, || restored.verify(&action)));
        }
        for (p, lib) in &natives {
            let label = format!("native {}", std::path::Path::new(p).file_name().unwrap().to_string_lossy());
            let m = show(&label, time(n, || lib.verify(&action)));
            println!("{:<24} {:<34} wasm/native median ratio {:.2}x", "", "", w / m);
        }
    }
}
