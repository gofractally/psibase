#!/usr/bin/env python3
"""Pinned Rust API corpus, parsed with syn without building upstream source.

This collects syntactically public declarations, not inferred call sites.
Macro expansion and export/re-export reachability are intentionally not inferred.
Run with --self-test for focused parser tests; --refresh changes upstream pins.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = ROOT / "build-method-names/corpus-cache"
META = HERE / "expansion-rust-metadata.json"
BINARY = ROOT / "build-method-names/rust-corpus-parser/release/method-corpus-rust-parser"
SOURCES = {
    "rust-stdlib": ("rust-lang/rust", ("library/core/src/", "library/alloc/src/", "library/std/src/"), "MIT OR Apache-2.0"),
    "rust-tokio": ("tokio-rs/tokio", ("tokio/src/", "tokio-util/src/", "tokio-stream/src/"), "MIT"),
    "rust-futures": ("rust-lang/futures-rs", ("futures-core/src/", "futures-util/src/", "futures-executor/src/", "futures-channel/src/", "futures-io/src/", "futures-sink/src/", "futures-task/src/", "futures/src/"), "MIT OR Apache-2.0"),
    "rust-serde": ("serde-rs/serde", ("serde/src/", "serde_core/src/"), "MIT OR Apache-2.0"),
    "rust-axum": ("tokio-rs/axum", ("axum/src/", "axum-core/src/", "axum-extra/src/"), "MIT"),
    "rust-reqwest": ("seanmonstar/reqwest", ("src/",), "MIT OR Apache-2.0"),
    "rust-rayon": ("rayon-rs/rayon", ("src/", "rayon-core/src/"), "MIT OR Apache-2.0"),
    "rust-clap": ("clap-rs/clap", ("src/", "clap_builder/src/", "clap_complete/src/", "clap_lex/src/"), "MIT OR Apache-2.0"),
    "rust-regex": ("rust-lang/regex", ("src/",), "MIT OR Apache-2.0"),
    "rust-diesel": ("diesel-rs/diesel", ("diesel/src/", "diesel_migrations/src/"), "MIT OR Apache-2.0"),
    "rust-crossbeam": ("crossbeam-rs/crossbeam", ("crossbeam/src/", "crossbeam-channel/src/", "crossbeam-deque/src/", "crossbeam-epoch/src/", "crossbeam-queue/src/", "crossbeam-utils/src/"), "MIT OR Apache-2.0"),
}

def sha(data): return hashlib.sha256(data).hexdigest()

def request(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Psibase-method-codec-research"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()

def cached(url, path):
    if not path.exists():
        data = request(url)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)
    return path.read_bytes()

def selected(source, path, prefixes):
    if not path.endswith(".rs") or not path.startswith(prefixes): return False
    pieces = path.split("/")
    if any(p in ("test", "tests", "bench", "benches", "examples", "test_util", "test-util") for p in pieces): return False
    if Path(path).stem in ("test", "tests", "bench", "benches"): return False
    if source == "rust-stdlib" and path.startswith(("library/std/src/sys/", "library/std/src/sys_common/")): return False
    if "/__private/" in path or "/private/" in path: return False
    return True

def module_name(path):
    result = path[:-3].replace("/", "::")
    return re.sub(r"::(?:lib|mod)$", "", result)

def collect(source, old, refresh):
    repo, prefixes, license_id = SOURCES[source]
    revision = None if refresh else old.get("revision")
    tag = "1.85.0" if source == "rust-stdlib" else None
    if tag and (refresh or old.get("source_tag") != tag):
        # A known released source snapshot avoids unstable master grammar.
        # This is corpus selection, not an installation recommendation.
        revision = json.loads(request(f"https://api.github.com/repos/{repo}/commits/{tag}"))["sha"]
    if revision is None:
        revision = json.loads(request(f"https://api.github.com/repos/{repo}/commits?per_page=1"))[0]["sha"]
    assert re.fullmatch(r"[0-9a-f]{40}", revision)
    url = f"https://codeload.github.com/{repo}/tar.gz/{revision}"
    data = cached(url, CACHE / f"{source}-{revision}.tar.gz")
    digest = sha(data)
    if old.get("revision") == revision and old.get("download_sha256") != digest:
        raise ValueError(f"Changed immutable archive for {source}")
    files, inputs, licenses = [], [], []
    license_dir = HERE / "licenses"
    license_dir.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            if not member.isfile(): continue
            path = member.name.split("/", 1)[1]
            if "/" not in path and (path.startswith("LICENSE") or path in ("COPYRIGHT", "NOTICE")):
                value = archive.extractfile(member).read()
                destination = license_dir / f"{source}-{path}"
                destination.write_bytes(value)
                licenses.append({"upstream_path":path,"local_path":str(destination.relative_to(HERE)),"sha256":sha(value)})
            if selected(source, path, prefixes):
                value = archive.extractfile(member).read()
                files.append({"path":path,"sha256":sha(value),"bytes":len(value)})
                inputs.append({"path":path,"module":module_name(path),"text":value.decode("utf-8")})
    if not licenses: raise ValueError(f"No license found for {source}")
    proc = subprocess.run([str(BINARY)], input="".join(json.dumps(v)+"\n" for v in inputs), text=True, capture_output=True, check=True)
    rows, errors, seen = [], [], set()
    for answer in map(json.loads, proc.stdout.splitlines()):
        path = answer["path"]
        if "error" in answer:
            errors.append({"path":path,"error":answer["error"],"line":answer["error_line"]})
        for entry in answer["rows"]:
            family = entry["family"]
            key = family, entry["method"], path
            if key in seen: continue
            seen.add(key)
            rows.append({"source":source,"ecosystem":"rust","provider":repo.split("/")[0],
                         "kind":entry["kind"],"service":family,"split_group":source+":"+family,
                         "method":entry["method"],"path":path,"line":entry["line"],"revision":revision})
    rows.sort(key=lambda r:(r["service"],r["method"],r["path"]))
    if not rows: raise ValueError(f"No Rust declarations from {source}")
    meta = {"repository":repo,"url":f"https://github.com/{repo}","revision":revision,"license":license_id,
            "licenses":licenses,"download_url":url,"download_sha256":digest,"download_bytes":len(data),
            "selected_prefixes":list(prefixes),"definition_files_inspected":len(inputs),"files":sorted(files,key=lambda f:f["path"]),
            "parse_error_count":len(errors),"parse_errors":errors,
            "records":len(rows),"unique_methods":len({r["method"] for r in rows}),
            "services":len({r["service"] for r in rows}),"kinds":dict(Counter(r["kind"] for r in rows))}
    if tag:
        meta["source_tag"] = tag
        meta["selection"] = "Official released historical source snapshot to avoid unstable master grammar; source syntax is not rewritten"
    return source, meta, rows

def build_parser():
    subprocess.run(["cargo","build","--offline","--locked","--release","--manifest-path",str(HERE/"rust-declaration-parser/Cargo.toml"),"--target-dir",str(ROOT/"build-method-names/rust-corpus-parser")],check=True)

def self_test():
    text = '''
pub fn exposed() {} fn private() {} pub(crate) fn restricted() {}
pub trait Public { fn trait_method(&self); #[doc(hidden)] fn hidden(&self); }
trait Secret { fn no(&self); }
pub struct Thing;
impl Thing { pub fn method(&self) {} fn private(&self) {} pub(crate) fn crate_only() {} }
impl Public for Thing { fn trait_method(&self) {} }
#[cfg(test)] mod tests { pub fn no_test() {} }
#[cfg(all(test, feature = "std"))] pub fn nested_test_cfg() {}
#[cfg(any(test, feature = "std"))] pub fn also_public() {}
mod nested { pub fn nested_public() {} }
#[doc(hidden)] pub fn undocumented() {}
pub fn contains_local() { pub fn local() {} }
macro_rules! generated { () => { pub fn generated() {} }; }
pub fn r#type() {}
'''
    result = subprocess.run([str(BINARY)],input=json.dumps({"path":"fixture.rs","module":"fixture","text":text})+"\n",text=True,capture_output=True,check=True)
    answer = json.loads(result.stdout)
    assert "error" not in answer, answer
    names = {r["method"] for r in answer["rows"]}
    assert names == {"exposed","trait_method","method","nested_public","contains_local","type","also_public"}, names
    assert selected("rust-stdlib","library/core/src/slice/mod.rs",SOURCES["rust-stdlib"][1])
    assert not selected("rust-stdlib","library/core/tests/slice.rs",SOURCES["rust-stdlib"][1])
    assert not selected("rust-stdlib","library/std/src/sys/pal/unix/mod.rs",SOURCES["rust-stdlib"][1])
    print("Rust AST extraction fixture passed: visibility, traits, impls, cfg(test), doc(hidden), nesting, macros, raw identifiers")

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh",action="store_true")
    ap.add_argument("--self-test",action="store_true")
    args = ap.parse_args()
    CACHE.mkdir(parents=True,exist_ok=True)
    build_parser()
    self_test()
    if args.self_test: return
    previous = json.loads(META.read_text()).get("sources",{}) if META.exists() else {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda s:collect(s,previous.get(s,{}),args.refresh),SOURCES))
    rows = [r for _,_,records in results for r in records]
    out = HERE / "expansion-rust.jsonl"
    out.write_text("".join(json.dumps(r,sort_keys=True)+"\n" for r in rows))
    meta = {"purpose":"Diverse Rust public API declarations for method-name codec research","ecosystem":"rust",
            "downloaded_code_executed":False,"upstream_crates_built":False,
            "parser":"syn 2.0.108 full syntax AST; locked local Rust helper",
            "parser_source_sha256":{name:sha((HERE/"rust-declaration-parser"/name).read_bytes()) for name in ("Cargo.toml","Cargo.lock","src/main.rs")},
            "sources":{s:m for s,m,_ in results},"records":len(rows),"corpus_sha256":sha(out.read_bytes()),
            "limitations":[
                "Syntactically pub functions and inherent methods, plus methods of pub traits; pub(crate)/pub(super) excluded; trait impl repetitions excluded.",
                "Function bodies and macro token bodies are never traversed. Generated macro APIs are not counted; this undercounts macro-heavy libraries such as Diesel and standard primitive APIs.",
                "Path test/bench/example directories, doc(hidden) items and cfg expressions requiring cfg(test) are excluded. Other feature/target predicates are treated as unknown; no single platform's feature configuration is evaluated.",
                "Private-module public declarations may be re-exported; reachability/re-exports and self-type public visibility are not resolved. Counts are declaration candidates, not certified reachable exported APIs.",
                "Standard-library sys platform internals excluded; source includes all remaining target-specific API alternatives rather than one compiled platform.",
                "Files rejected by syn (including unsupported newer Rust syntax) are skipped and listed individually; no regex fallback silently enlarges the API sample.",
                "Rust compiler edition resolution, unstable-feature gates and type checking are not performed. Files from all selected crates/editions are attempted with the same syntax parser; grammar rejections are recorded, not rewritten.",
                "Methods are coalesced within declaration family/file; names recur legitimately across types/crates and must be deduplicated/balanced in training."]}
    META.write_text(json.dumps(meta,indent=2,sort_keys=True)+"\n")
    print(json.dumps({s:{k:m[k] for k in ("revision","records","unique_methods","services","definition_files_inspected","parse_error_count")} for s,m,_ in results},indent=2))

if __name__ == "__main__": main()
