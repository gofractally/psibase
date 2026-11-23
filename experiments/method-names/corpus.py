#!/usr/bin/env python3
"""Collect pinned public API identifiers for an experimental method-name codec.

Downloads are read as data only. No downloaded source is executed. Large source
archives live outside this experiment in build-method-names/corpus-cache.
Existing corpus-metadata.json pins revisions unless --refresh is requested.
"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / "build-method-names/corpus-cache"
META = HERE / "corpus-metadata.json"
SOURCES = {
    "googleapis": ("googleapis/googleapis", "Apache-2.0"),
    "ethereum": ("ethereum/execution-apis", "CC0-1.0"),
    "kubernetes": ("kubernetes/kubernetes", "Apache-2.0"),
    "typescript-dom": ("microsoft/TypeScript-DOM-lib-generator", "Apache-2.0"),
    "typescript-es": ("microsoft/TypeScript", "Apache-2.0"),
    "ccxt": ("ccxt/ccxt", "MIT"),
    "ethers": ("ethers-io/ethers.js", "MIT"),
}
INITIAL_REVISIONS = {
    "ccxt": "1d184b2a025d4008d03ec9dd1ff74ae726067d17",
    "ethers": "3ea4c226dd0b3a074abf90748de9d11192027f4f",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def request(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Psibase-method-codec-research"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def cached(url, path):
    if not path.exists():
        data = request(url)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)
    return path.read_bytes()


def clean_proto(text):
    # Keep all source offsets while hiding comments and string contents. Braces
    # in HTTP path annotations must not terminate a protobuf service body.
    pattern = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/'
    return re.sub(pattern, lambda match: re.sub(r"[^\n]", " ", match[0]), text)


def proto_records(path, text, revision):
    clean = clean_proto(text)
    package = re.search(r"\bpackage\s+([A-Za-z_][\w.]*)\s*;", clean)
    package = package[1] if package else ""
    for service in re.finditer(r"\bservice\s+([A-Za-z_]\w*)\s*\{", clean):
        begin, depth, cursor = service.end(), 1, service.end()
        while cursor < len(clean) and depth:
            depth += (clean[cursor] == "{") - (clean[cursor] == "}")
            cursor += 1
        if depth:
            raise ValueError(f"Unclosed service declaration: {path}")
        full_service = ".".join(filter(None, [package, service[1]]))
        # Sibling API version directories and packages share one split group.
        group = re.sub(r"(?:^|\.)v\d+[A-Za-z0-9_]*(?=\.|$)", "", full_service)
        for rpc in re.finditer(r"\brpc\s+([A-Za-z_]\w*)\s*\(", clean[begin:cursor - 1]):
            yield {"source": "googleapis", "kind": "protobuf_rpc", "service": full_service,
                   "split_group": "googleapis:" + group, "method": rpc[1],
                   "path": path, "revision": revision}


def declaration_records(source, path, text, revision, declaration_kind="interface"):
    """Named methods directly inside TypeScript interfaces, not function properties.

    This lexical extraction intentionally excludes computed/symbol names,
    anonymous call/constructor signatures, and object-valued property members.
    Overloads in one interface/file coalesce to one API identifier.
    """
    pattern = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*[\s\S]*?\*/'
    clean = re.sub(pattern, lambda match: re.sub(r"[^\n]", " ", match[0]), text)

    def body_after(position):
        begin = clean.find("{", position)
        if begin < 0:
            return None
        depth, cursor = 1, begin + 1
        while cursor < len(clean) and depth:
            depth += (clean[cursor] == "{") - (clean[cursor] == "}")
            cursor += 1
        if depth:
            raise ValueError(f"Unclosed declaration body: {path}")
        return begin + 1, cursor - 1

    namespaces = []
    for match in re.finditer(r"\bnamespace\s+([A-Za-z_$][\w$.]*)\s*\{", clean):
        body = body_after(match.end() - 1)
        namespaces.append((*body, match[1]))
    seen = set()
    for interface in re.finditer(r"\b" + re.escape(declaration_kind) + r"\s+([A-Za-z_$][\w$]*)\b", clean):
        body = body_after(interface.end())
        if body is None:
            continue
        begin, end = body
        content = clean[begin:end]
        depth_at, depth = [], 0
        for char in content:
            depth_at.append(depth)
            depth += (char == "{") - (char == "}")
        namespace = ".".join(name for start, stop, name in namespaces
                             if start <= interface.start() < stop)
        service = ".".join(filter(None, [namespace, interface[1]]))
        for method in re.finditer(r"(?m)^\s*([A-Za-z_$][\w$]*)\??\s*(?=[<(])", content):
            name = method[1]
            if name == "new" or depth_at[method.start(1)] != 0:
                continue
            key = service, name
            if key in seen:
                continue
            seen.add(key)
            yield {"source": source, "kind": "typescript_interface_method", "service": service,
                   "split_group": source + ":" + service, "method": name,
                   "path": path, "revision": revision}


def financial_source(source, repo, revision, old):
    paths = {
        "ccxt": ["ts/src/base/Exchange.ts", "js/src/base/Exchange.d.ts"],
        "ethers": ["src.ts/providers/provider.ts", "src.ts/providers/signer.ts",
                   "src.ts/providers/contracts.ts"],
    }[source]
    files, contents = [], {}
    for path in paths:
        url = f"https://raw.githubusercontent.com/{repo}/{revision}/{path}"
        data = cached(url, CACHE / f"{source}-{revision}-{path.replace('/', '_')}")
        files.append({"path": path, "url": url, "sha256": sha(data), "bytes": len(data)})
        contents[path] = data.decode("utf-8")
    digest = sha(json.dumps(files, sort_keys=True).encode())
    if old.get("revision") == revision and old.get("download_sha256") != digest:
        raise ValueError(f"Pinned financial declaration digest changed for {source}")
    records = []
    if source == "ccxt":
        text = contents["ts/src/base/Exchange.ts"]
        start = re.search(r"['\"]has['\"]\s*:\s*\{", text)
        if not start:
            raise ValueError("CCXT unified capability map not found")
        # Current capability-map entries are scalar feature flags. Its lexical
        # boundary is validated against the next root sibling, not all adapters.
        stop = text.find("\n            },", start.end())
        if stop < 0:
            raise ValueError("CCXT unified capability map boundary not found")
        capabilities = set(re.findall(r"(?m)^\s*['\"]([A-Za-z_]\w*)['\"]\s*:", text[start.end():stop]))
        path = "js/src/base/Exchange.d.ts"
        for row in declaration_records(source, path, contents[path], revision, "class"):
            if row["method"] in capabilities:
                row["kind"] = "ccxt_unified_capability_method"
                row["split_group"] = "ccxt:Exchange"
                records.append(row)
        extraction = "Only base-class declared method signatures intersecting the unified has capability map; raw REST aliases, properties and internal helpers excluded"
    else:
        for path, text in contents.items():
            for row in declaration_records(source, path, text, revision):
                row["kind"] = "ethers_public_interface_method"
                records.append(row)
        extraction = "Named public interface methods in provider, signer and contract-runner definitions; implementation classes/private helpers excluded"
    return records, {"download_kind": "pinned raw unified API declarations",
                     "download_sha256": digest, "download_bytes": sum(item["bytes"] for item in files),
                     "definition_files_inspected": len(files), "downloads": files,
                     "extraction": extraction}


def declaration_source(source, repo, revision, old):
    """Pinned raw declaration files avoid a very large TypeScript source archive."""
    if source == "typescript-dom":
        tree_url = f"https://api.github.com/repos/{repo}/git/trees/{revision}?recursive=1"
        tree_data = cached(tree_url, CACHE / f"typescript-dom-{revision}-tree.json")
        tree = json.loads(tree_data)
        if tree.get("truncated"):
            raise ValueError("DOM declaration tree is incomplete")
        paths = [item["path"] for item in tree["tree"] if item["type"] == "blob"
                 and item["path"].startswith("baselines/") and item["path"].count("/") == 1
                 and item["path"].endswith(".d.ts")]
    else:
        listing_url = f"https://api.github.com/repos/{repo}/contents/src/lib?ref={revision}"
        listing = json.loads(cached(listing_url, CACHE / f"typescript-es-{revision}-listing.json"))
        paths = [item["path"] for item in listing if item["name"].startswith("es")
                 and item["name"].endswith(".d.ts")]

    def download(path):
        url = f"https://raw.githubusercontent.com/{repo}/{revision}/{path}"
        data = cached(url, CACHE / f"{source}-{revision}-{path.replace('/', '_')}")
        item = {"path": path, "url": url, "sha256": sha(data), "bytes": len(data)}
        records = list(declaration_records(source, path, data.decode("utf-8"), revision))
        return item, records

    with ThreadPoolExecutor(max_workers=8) as executor:
        downloads = list(executor.map(download, sorted(paths)))
    files = [item for item, _ in downloads]
    digest = sha(json.dumps(files, sort_keys=True).encode())
    if old.get("revision") == revision and old.get("download_sha256") != digest:
        raise ValueError(f"Pinned declaration digest changed for {source}")
    return [row for _, records in downloads for row in records], {
        "download_kind": "pinned raw declaration files",
        "download_sha256": digest, "download_bytes": sum(item["bytes"] for item in files),
        "definition_files_inspected": len(files), "downloads": files,
        "extraction": "Named top-level interface methods; function properties and computed symbol methods excluded; same-interface/file overloads coalesced",
    }


def collect(source, previous, refresh):
    repo, license_name = SOURCES[source]
    old = previous.get(source, {})
    revision = old.get("revision") if not refresh else None
    if not revision and not refresh:
        revision = INITIAL_REVISIONS.get(source)
    if not revision:
        if source == "typescript-es":
            # Deliberately use a stable historical source-layout release; main
            # has since changed project structure. This is corpus selection,
            # not a recommendation to install that TypeScript version.
            revision = json.loads(request(f"https://api.github.com/repos/{repo}/commits/v5.9.3"))["sha"]
        else:
            commits = json.loads(request(f"https://api.github.com/repos/{repo}/commits?per_page=1"))
            revision = commits[0]["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("A full immutable commit ID is required")
    metadata = {"repository": repo, "url": f"https://github.com/{repo}",
                "revision": revision, "license": license_name,
                "license_url": f"https://github.com/{repo}/blob/{revision}/LICENSE"}
    records = []
    licenses = HERE / "licenses"
    licenses.mkdir(exist_ok=True)
    if source in ("ccxt", "ethers"):
        records, details = financial_source(source, repo, revision, old)
        metadata.update(details)
        license_path = "LICENSE.txt" if source == "ccxt" else "LICENSE.md"
        license_url = f"https://raw.githubusercontent.com/{repo}/{revision}/{license_path}"
        license_data = cached(license_url, CACHE / f"{source}-{revision}-{license_path}")
        if old.get("revision") == revision and old.get("license_sha256") != sha(license_data):
            raise ValueError(f"Pinned license digest changed for {source}")
        (licenses / f"{source}-{license_path}").write_bytes(license_data)
        metadata["license_url"] = f"https://github.com/{repo}/blob/{revision}/{license_path}"
        metadata["license_sha256"] = sha(license_data)
    elif source.startswith("typescript-"):
        records, details = declaration_source(source, repo, revision, old)
        metadata.update(details)
        if source == "typescript-es":
            metadata["selection"] = "Official v5.9.3 historical source release for ECMAScript library declarations"
        license_path = "LICENSE.txt"
        license_url = f"https://raw.githubusercontent.com/{repo}/{revision}/{license_path}"
        license_data = cached(license_url, CACHE / f"{source}-{revision}-LICENSE.txt")
        if old.get("revision") == revision and old.get("license_sha256") != sha(license_data):
            raise ValueError(f"Pinned license digest changed for {source}")
        (licenses / f"{source}-LICENSE.txt").write_bytes(license_data)
        metadata["license_url"] = f"https://github.com/{repo}/blob/{revision}/{license_path}"
        metadata["license_sha256"] = sha(license_data)
    elif source == "kubernetes":
        path = "api/openapi-spec/swagger.json"
        url = f"https://raw.githubusercontent.com/{repo}/{revision}/{path}"
        data = cached(url, CACHE / f"kubernetes-{revision}-swagger.json")
        if old.get("revision") == revision and old.get("download_sha256") != sha(data):
            raise ValueError(f"Pinned download digest changed for {source}")
        document = json.loads(data)
        metadata.update(download_url=url, download_sha256=sha(data), download_bytes=len(data))
        for route, entry in document.get("paths", {}).items():
            for verb, operation in entry.items():
                if verb not in ("get", "post", "put", "patch", "delete", "head", "options"):
                    continue
                name = operation.get("operationId")
                if not name:
                    continue
                tags = operation.get("tags", ["unknown"])
                service = "kubernetes." + tags[0]
                group = re.sub(r"_v\d+[A-Za-z0-9]*$", "", service)
                records.append({"source": source, "kind": "openapi_operation_id", "service": service,
                                "split_group": "kubernetes:" + group, "method": name,
                                "path": f"{path}#{verb.upper()} {route}", "revision": revision})
        license_data = cached(f"https://raw.githubusercontent.com/{repo}/{revision}/LICENSE",
                              CACHE / f"kubernetes-{revision}-LICENSE")
        if old.get("revision") == revision and old.get("license_sha256") != sha(license_data):
            raise ValueError("Pinned Kubernetes license digest changed")
        (licenses / f"{source}-LICENSE").write_bytes(license_data)
        metadata["license_sha256"] = sha(license_data)
    else:
        url = f"https://codeload.github.com/{repo}/tar.gz/{revision}"
        data = cached(url, CACHE / f"{source}-{revision}.tar.gz")
        if old.get("revision") == revision and old.get("download_sha256") != sha(data):
            raise ValueError(f"Pinned archive digest changed for {source}")
        metadata.update(download_url=url, download_sha256=sha(data), download_bytes=len(data))
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            inspected = 0
            for member in archive:
                if not member.isfile():
                    continue
                path = member.name.split("/", 1)[1]
                if path in ("LICENSE", "LICENSE.txt", "NOTICE"):
                    value = archive.extractfile(member).read()
                    (licenses / f"{source}-{Path(path).name}").write_bytes(value)
                    metadata[Path(path).name.lower() + "_sha256"] = sha(value)
                if source == "googleapis" and path.endswith(".proto"):
                    inspected += 1
                    text = archive.extractfile(member).read().decode("utf-8")
                    records.extend(proto_records(path, text, revision))
                elif source == "ethereum" and path.startswith("src/") and path.endswith((".yaml", ".yml")):
                    inspected += 1
                    text = archive.extractfile(member).read().decode("utf-8")
                    # RPC method lists use unindented '- name:'. Nested params
                    # and schemas are not method identifiers.
                    for match in re.finditer(r"(?m)^-\s+name:\s*['\"]?([A-Za-z][A-Za-z0-9_]*)", text):
                        name = match[1]
                        if "_" not in name:
                            continue
                        namespace = name.split("_", 1)[0]
                        records.append({"source": source, "kind": "json_rpc", "service": namespace,
                                        "split_group": "ethereum:" + namespace, "method": name,
                                        "path": path, "revision": revision})
            metadata["definition_files_inspected"] = inspected
    # Repeated endpoint occurrences remain visible in records, so callers can
    # choose occurrence weighting or unique-name weighting deliberately.
    records.sort(key=lambda row: (row["service"], row["method"], row["path"]))
    metadata.update(records=len(records), unique_methods=len({row["method"] for row in records}),
                    services=len({row["service"] for row in records}),
                    split_groups=len({row["split_group"] for row in records}))
    if not records:
        raise ValueError(f"No method records extracted from {source}")
    return source, metadata, records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="select new upstream revisions explicitly")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    previous = json.loads(META.read_text()).get("sources", {}) if META.exists() else {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda source: collect(source, previous, args.refresh), SOURCES))
    all_records = [row for _, _, rows in results for row in rows]
    output = HERE / "corpus.jsonl"
    temporary = output.with_suffix(".jsonl.tmp")
    temporary.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in all_records))
    temporary.replace(output)
    metadata = {"purpose": "Read-only extracted API identifiers for a method codec experiment",
                "downloaded_code_executed": False,
                "sources": {name: item for name, item, _ in results},
                "corpus_sha256": sha(output.read_bytes()), "records": len(all_records),
                "split_guidance": "Group by source/service family, collapse canonical method duplicates before train/test splitting; do not random-split versioned RPC occurrences.",
                "limitations": ["Identifier extraction is lexical, not a full protobuf/YAML/TypeScript parser.",
                                "OpenAPI operationIds are generated public API names, not simple source function declarations.",
                                "TypeScript interface methods exclude computed Symbol names and callable properties; overloads coalesce within interface/file.",
                                "CCXT is restricted to declared unified capability methods, not all exported base-class helpers or exchange adapters.",
                                "Google service/version duplicates are retained explicitly; report unique names as well as occurrence-weighted results."]}
    temporary = META.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    temporary.replace(META)
    print(json.dumps({name: {key: item[key] for key in ("revision", "records", "unique_methods", "services", "split_groups")}
                      for name, item, _ in results}, indent=2))


if __name__ == "__main__":
    main()
