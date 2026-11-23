#!/usr/bin/env python3
"""Pinned public C++ API declarations for the method-name codec experiment.

Dependency setup (downloaded project sources are never executed):
  python3 -m venv build-method-names/corpus-cpp-venv
  build-method-names/corpus-cpp-venv/bin/pip install -r experiments/method-names/requirements-cpp.txt
The script reuses that interpreter when invoked with the system Python.
"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import importlib.metadata
import io
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = ROOT / "build-method-names/corpus-cache"
META = HERE / "expansion-cpp-metadata.json"
OUT = HERE / "expansion-cpp.jsonl"
BOOST_MODULES = ("asio", "beast", "container", "multi_index", "filesystem", "json",
                 "url", "unordered", "algorithm", "math")
SOURCES = {"libcxx": ("llvm/llvm-project", "Apache-2.0 WITH LLVM-exception")}
SOURCES.update({"boost-" + module: ("boostorg/" + module, "BSL-1.0") for module in BOOST_MODULES})
SOURCES.update({"qt-core": ("qt/qtbase", "per-header SPDX expression; see files"),
                "qt-network": ("qt/qtbase", "per-header SPDX expression; see files")})
VERSIONS = {"tree-sitter": "0.25.2", "tree-sitter-cpp": "0.23.4"}
EXTRACTOR_VERSION = 3


def sha(data):
    return hashlib.sha256(data).hexdigest()


def request(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Psibase-method-codec-research"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def cached(url, path):
    if not path.exists():
        data = request(url)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
    return path.read_bytes()


def setup_parser():
    try:
        import tree_sitter
        import tree_sitter_cpp
    except ImportError:
        interpreter = ROOT / "build-method-names/corpus-cpp-venv/bin/python"
        if interpreter.exists() and Path(sys.prefix) != interpreter.parent.parent:
            os.execv(str(interpreter), [str(interpreter), str(Path(__file__).resolve()), *sys.argv[1:]])
        raise SystemExit("Install pinned requirements-cpp.txt into build-method-names/corpus-cpp-venv first")
    for package, version in VERSIONS.items():
        if importlib.metadata.version(package) != version:
            raise SystemExit(f"{package}=={version} is required for reproducible extraction")
    return tree_sitter.Parser(tree_sitter.Language(tree_sitter_cpp.language()))


def name_text(node, data):
    return data[node.start_byte:node.end_byte].decode("utf-8") if node else ""


def declared_name(node, data):
    """Find a named declarator; never inspect expression/call AST nodes."""
    if node.type in ("identifier", "field_identifier", "type_identifier", "namespace_identifier"):
        return name_text(node, data)
    if node.type in ("operator_name", "destructor_name", "conversion_function"):
        return None
    child = node.child_by_field_name("declarator")
    if child:
        return declared_name(child, data)
    if node.type in ("qualified_identifier", "scoped_identifier", "template_function"):
        child = node.child_by_field_name("name")
        return declared_name(child, data) if child else None
    return None


def lexical_depths(data, include_clean=False):
    """Independent brace depths, masking strings, comments and directives.

    This guard prevents an error-recovering AST parser from treating methods of
    a prematurely closed class as namespace functions (including private APIs).
    UTF-8 byte offsets and source length remain unchanged.
    """
    literal = (rb'(?:u8|u|U|L)?R"([^\s()\\]{0,16})\([\s\S]*?\)\1"'
               rb'|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/')
    clean = re.sub(literal, lambda m: re.sub(rb"[^\n]", b" ", m[0]), data)
    lines, continuation = [], False
    for line in clean.splitlines(keepends=True):
        directive = continuation or line.lstrip().startswith(b"#")
        continuation = directive and line.rstrip(b"\r\n").endswith(b"\\")
        lines.append(re.sub(rb"[^\n]", b" ", line) if directive else line)
    clean = b"".join(lines)
    depths, depth = [], 0
    for byte in clean:
        depths.append(depth)
        depth += (byte == 123) - (byte == 125)
    return (depths, depth, clean) if include_clean else (depths, depth)


def declarations(text, source, path, revision, parser, line_offset=0):
    """Walk declaration ASTs, respecting class access and never entering bodies.

    No preprocessing is done: all conditional branches remain visible. Tree-sitter
    tolerates unknown C++ macros; explicit ERROR subtrees are excluded. This is a
    conservative syntactic API selection, not a semantic export/ABI checker.
    """
    data = text.encode("utf-8")
    tree = parser.parse(data)
    depths, final_depth = lexical_depths(data)
    rows = []
    stats = Counter()
    stats["files_with_unbalanced_lexical_braces"] = int(final_depth != 0)
    forbidden_scope = re.compile(r"(^|_)(detail|details|aux|auxiliary|internal|impl|implementation)(_|$)")
    path_parts = Path(path).parts
    component = Path(path).name if source == "libcxx" else (
        path_parts[3] if len(path_parts) > 4 else Path(path).stem)
    provider = "llvm" if source == "libcxx" else "qt" if source.startswith("qt-") else "boost"

    def add(node, scopes, classes, public):
        if not public or any(forbidden_scope.search(part) for scope in scopes for part in scope.split("::")):
            return
        if depths[node.start_byte] != len(scopes):
            stats["excluded_scope_recovery_nodes"] += 1
            return
        declarator = node.child_by_field_name("declarator")
        if not declarator:
            return
        # Function-pointer fields are not functions; the direct declarator must
        # be a function declarator (possibly nested in a pointer return type).
        cursor = declarator
        while cursor.type in ("pointer_declarator", "reference_declarator"):
            cursor = cursor.child_by_field_name("declarator")
            if not cursor:
                return
        if cursor.type != "function_declarator":
            return
        child = cursor.child_by_field_name("declarator")
        if not child or child.type in ("parenthesized_declarator", "abstract_parenthesized_declarator"):
            return
        name = declared_name(child, data)
        if not name or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
            return
        if name.startswith("_") or name.isupper() or name in classes or name in {"noexcept", "decltype", "sizeof", "alignof", "requires"}:
            return
        # Public methods occasionally have qualified out-of-class definitions;
        # skip those, as the in-class declaration is the API reference.
        if child.type in ("qualified_identifier", "scoped_identifier"):
            return
        service = "::".join(scopes) or ("std" if source == "libcxx" else "Qt" if source.startswith("qt-") else "boost")
        rows.append({"source": source, "kind": "cpp_public_declaration", "service": service,
                     "split_group": source + ":" + component, "method": name, "path": path,
                     "revision": revision, "ecosystem": "cpp", "provider": provider,
                     "line": node.start_point.row + 1 + line_offset})

    def walk(node, scopes=(), classes=(), public=True):
        if node.type == "ERROR":
            stats["excluded_error_nodes"] += 1
            return
        if node.type == "namespace_definition":
            name = name_text(node.child_by_field_name("name"), data)
            # Anonymous namespaces are never public API.
            if not name:
                return
            if any(forbidden_scope.search(part) for part in name.split("::")):
                return
            body = node.child_by_field_name("body")
            if body:
                walk(body, scopes + (name,), classes, public)
            return
        if node.type in ("class_specifier", "struct_specifier", "union_specifier"):
            name = name_text(node.child_by_field_name("name"), data)
            body = node.child_by_field_name("body")
            if not name or not body or not public:
                return
            access = node.type != "class_specifier"
            for child in body.named_children:
                if child.type == "access_specifier":
                    access = name_text(child, data) == "public"
                else:
                    walk(child, scopes + (name,), classes + (name,), access)
            return
        if node.type in ("function_definition", "declaration", "field_declaration"):
            add(node, scopes, classes, public)
            # Declarations may hold nested class bodies. A function body is
            # never visited: local declarations, lambdas, calls are excluded.
            if node.type != "function_definition":
                for child in node.named_children:
                    if child.type in ("class_specifier", "struct_specifier", "union_specifier"):
                        walk(child, scopes, classes, public)
            return
        if node.type in ("parameter_declaration", "optional_parameter_declaration", "compound_statement",
                         "lambda_expression", "argument_list", "expression_statement", "comment"):
            return
        for child in node.named_children:
            walk(child, scopes, classes, public)

    walk(tree.root_node)
    dedup = {}
    for row in rows:
        dedup.setdefault((row["service"], row["method"]), row)
    stats.update(raw_declarations=len(rows), coalesced_declarations=len(dedup),
                 files_with_parse_errors=int(tree.root_node.has_error))
    return list(dedup.values()), stats


def synopsis(text):
    for match in re.finditer(r"/\*[\s\S]*?\*/", text):
        if not re.search(r"\bsynopsis\b", match[0], re.I):
            continue
        body = match[0][2:-2]
        # Retain line count and offsets while removing the prose heading.
        first_namespace = re.search(r"\bnamespace\s+std\b", body)
        if not first_namespace:
            return None
        body = re.sub(r"[^\n]", " ", body[:first_namespace.start()]) + body[first_namespace.start():]
        return body, text.count("\n", 0, match.start())
    return None


def revision_for(source, repo, old, refresh):
    revision = old.get("revision") if not refresh else None
    if not revision:
        url = f"https://api.github.com/repos/{repo}/commits?per_page=1"
        discovery = CACHE / f"{repo.replace('/', '-')}-cpp-discovery.json"
        if refresh:
            data = request(url)
            discovery.write_bytes(data)
        else:
            data = cached(url, discovery)
        revision = json.loads(data)[0]["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError(f"Immutable commit required: {source}")
    return revision


def collect_libcxx(revision, parser):
    repo = "llvm/llvm-project"
    url = f"https://api.github.com/repos/{repo}/contents/libcxx/include?ref={revision}"
    listing = json.loads(cached(url, CACHE / f"libcxx-{revision}-include-list.json"))
    paths = sorted(item["path"] for item in listing if item["type"] == "file"
                   and not item["name"].startswith("_") and "." not in item["name"])

    def download(path):
        url = f"https://raw.githubusercontent.com/{repo}/{revision}/{path}"
        data = cached(url, CACHE / f"libcxx-{revision}-{Path(path).name}")
        return path, url, data

    with ThreadPoolExecutor(max_workers=8) as executor:
        values = list(executor.map(download, paths))
    records, files, stats = [], [], Counter()
    for path, url, data in values:
        item = {"path": path, "url": url, "sha256": sha(data), "bytes": len(data)}
        selected = synopsis(data.decode("utf-8"))
        if selected:
            rows, counts = declarations(selected[0], "libcxx", path, revision, parser, selected[1])
            records.extend(rows)
            stats.update(counts)
            item["selected_synopsis"] = True
            item["records"] = len(rows)
        else:
            item["selected_synopsis"] = False
        files.append(item)
    license_path = "libcxx/LICENSE.TXT"
    license_data = cached(f"https://raw.githubusercontent.com/{repo}/{revision}/{license_path}",
                          CACHE / f"libcxx-{revision}-LICENSE.TXT")
    return records, files, stats, license_path, license_data


def collect_boost(source, repo, revision, parser, old):
    url = f"https://codeload.github.com/{repo}/tar.gz/{revision}"
    data = cached(url, CACHE / f"{source}-{revision}.tar.gz")
    records, files, stats = [], [], Counter()
    licenses = []
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            path = member.name.split("/", 1)[1]
            if path in ("LICENSE_1_0.txt", "LICENSE", "LICENSE.txt"):
                licenses.append((path, archive.extractfile(member).read()))
            if source == "boost-multi_index" and Path(path).name in {
                    "ord_indices.html", "hash_indices.html", "seq_indices.html", "rnd_indices.html", "rnk_indices.html"}:
                value = archive.extractfile(member).read()
                rows, counts = documented_index_synopses(value.decode("iso-8859-1"), path, revision, parser)
                stats.update(counts)
                records.extend(rows)
                files.append({"path": path, "sha256": sha(value), "bytes": len(value),
                              "records": len(rows), "selection": "official reference class synopsis"})
            if not path.startswith("include/boost/") or not path.endswith((".hpp", ".h")):
                continue
            # Implementation, generated preprocessor expansions, internal
            # metaprogramming and test/example trees are not public declarations.
            if set(Path(path).parts) & {"detail", "impl", "aux_", "auxiliary", "preprocessed", "internal"}:
                continue
            value = archive.extractfile(member).read()
            rows, counts = declarations(value.decode("utf-8"), source, path, revision, parser)
            stats.update(counts)
            records.extend(rows)
            files.append({"path": path, "sha256": sha(value), "bytes": len(value), "records": len(rows)})
    license_repo, license_revision = repo, revision
    if not licenses:
        # Some module repos reference the distribution-wide Boost license from
        # their source headers rather than including a duplicate license file.
        license_repo = "boostorg/boost"
        retained = {"revision": old["license_revision"]} if old.get("license_repository") == license_repo else {}
        license_revision = revision_for("boost-license", license_repo, retained, False)
        license_path = "LICENSE_1_0.txt"
        license_data = cached(f"https://raw.githubusercontent.com/{license_repo}/{license_revision}/{license_path}",
                              CACHE / f"boost-license-{license_revision}.txt")
    else:
        license_path, license_data = licenses[0]
    return records, files, stats, license_path, license_data, {"download_url": url,
        "download_sha256": sha(data), "download_bytes": len(data),
        "license_repository": license_repo, "license_revision": license_revision}


def documented_index_synopses(text, path, revision, parser):
    """Read Boost's public index contract where the C++ type is unspecified.

    The reference explicitly places implementation types in a detail namespace;
    their public member contracts are nevertheless part of MultiIndex's API.
    Restrict to its full class-synopsis blocks, never usage examples/calls.
    Only English type placeholders are normalized for the declaration parser.
    """
    records, stats = [], Counter()
    for block, match in enumerate(re.finditer(r"<pre\b[^>]*>([\s\S]*?)</pre>", text, re.I)):
        plain = html.unescape(re.sub(r"<[^>]*>", "", match[1]))
        klass = re.search(r"\bclass\s+name\s+is\s+implementation\s+defined\s*\{", plain)
        if not klass:
            continue
        # The HTML formatter varies whitespace before `};`; match the actual
        # class brace with the same comment/string-aware lexical scanner.
        encoded = plain.encode("utf-8")
        opening = len(plain[:klass.end() - 1].encode("utf-8"))
        depths, _, clean = lexical_depths(encoded, include_clean=True)
        close_byte = next((i for i in range(opening + 1, len(clean))
                           if clean[i] == 125 and depths[i] == depths[opening] + 1), None)
        if close_byte is None:
            raise ValueError(f"Unterminated documented class synopsis: {path}")
        stop = len(encoded[:close_byte].decode("utf-8"))
        body = plain[klass.end():stop]
        if "public:" not in body:
            continue
        for phrase, replacement in (
            ("index class name", "documented_index"),
            ("implementation defined", "unspecified_type"),
            ("equivalent to", ""),
            ("same as owning container", "unspecified_type"),
            ("following [container.insert.return] spec", "unspecified_type")):
            body = body.replace(phrase, replacement)
        view = "namespace boost { namespace multi_index { class documented_index {\n" + body + "\n}; }}"
        rows, counts = declarations(view, "boost-multi_index", path, revision, parser)
        stats.update(counts)
        for row in rows:
            row.update(kind="cpp_documented_public_synopsis", service="boost::multi_index::" + Path(path).stem,
                       split_group="boost-multi_index:documented-index", path=path + f"#pre{block}",
                       synopsis_block=block)
            row.pop("line", None)  # Synthetic parse offsets are not HTML line numbers.
        records.extend(rows)
    return records, stats


def qt_declaration_view(text):
    """Mask Qt annotation/property macros without changing method identifiers.

    This is an explicit lexical declaration view, not macro expansion. Public
    signals are treated as public API; Q_SLOTS annotations are erased. All
    conditional preprocessor branches remain visible to the C++ parser.
    """
    def spaces(value):
        return re.sub(r"[^\n]", " ", value)
    text = re.sub(r"\bQT_BEGIN_NAMESPACE\b", lambda m: "namespace Qt {".ljust(len(m[0])), text)
    text = re.sub(r"\bQT_END_NAMESPACE\b", lambda m: "}".ljust(len(m[0])), text)
    text = re.sub(r"\bQ_SIGNALS\s*:", lambda m: "public:".ljust(len(m[0])), text)
    # Hide comments/strings only while locating balanced annotation arguments.
    lexical = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/',
                     lambda m: spaces(m[0]), text)
    spans = []
    for match in re.finditer(r"\bQ(?:T)?_[A-Z][A-Z0-9_]*\b", lexical):
        line_begin = lexical.rfind("\n", 0, match.start()) + 1
        if lexical[line_begin:match.start()].lstrip().startswith("#"):
            continue
        end = match.end()
        cursor = end
        while cursor < len(lexical) and lexical[cursor] in " \t":
            cursor += 1
        if cursor < len(lexical) and lexical[cursor] == "(":
            depth, cursor = 1, cursor + 1
            while cursor < len(lexical) and depth:
                depth += (lexical[cursor] == "(") - (lexical[cursor] == ")")
                cursor += 1
            if not depth:
                end = cursor
        spans.append((match.start(), end))
    chars = list(text)
    for begin, end in spans:
        chars[begin:end] = list(spaces(text[begin:end]))
    return "".join(chars)


def collect_qt(source, revision, parser):
    repo = "qt/qtbase"
    module = "corelib" if source == "qt-core" else "network"
    tree_url = f"https://api.github.com/repos/{repo}/git/trees/{revision}?recursive=1"
    listing = json.loads(cached(tree_url, CACHE / f"qtbase-{revision}-tree.json"))
    if listing.get("truncated"):
        raise ValueError("Qt source tree truncated")
    paths = sorted(item["path"] for item in listing["tree"] if item["type"] == "blob"
        and item["path"].startswith(f"src/{module}/") and Path(item["path"]).name.startswith("q")
        and item["path"].endswith(".h") and not item["path"].endswith(("_p.h", "_p_p.h", "_impl.h")))
    def download(path):
        url = f"https://raw.githubusercontent.com/{repo}/{revision}/{path}"
        data = cached(url, CACHE / f"qtbase-{revision}-{path.replace('/', '_')}")
        return path, url, data
    with ThreadPoolExecutor(max_workers=8) as executor:
        values = list(executor.map(download, paths))
    records, files, stats = [], [], Counter()
    for path, url, data in values:
        text = data.decode("utf-8")
        spdx = re.search(r"SPDX-License-Identifier:\s*([^\n]+)", text)
        item = dict(path=path, url=url, sha256=sha(data), bytes=len(data),
                    spdx_license=spdx[1].strip() if spdx else "not stated")
        if re.search(r"not part of the Qt API", text, re.I):
            item["excluded_private_api_warning"] = True
        else:
            rows, counts = declarations(qt_declaration_view(text), source, path, revision, parser)
            records.extend(rows)
            stats.update(counts)
            item["records"] = len(rows)
        files.append(item)
    license_paths = [item["path"] for item in listing["tree"] if item["type"] == "blob"
                     and item["path"].startswith("LICENSES/") and item["path"].endswith(".txt")]
    license_files = []
    for path, url, data in map(download, license_paths):
        (HERE / "licenses" / f"qtbase-{Path(path).name}").write_bytes(data)
        license_files.append(dict(path=path, url=url, sha256=sha(data), bytes=len(data)))
    # SPDX expressions are retained per header; copy all project license texts
    # rather than implying that one license uniformly covers every declaration.
    return records, files, stats, "LICENSES", json.dumps(license_files, sort_keys=True).encode(), {
        "download_kind": "pinned Qt public-looking headers; explicit private API warnings excluded",
        "license_files": license_files, "declaration_view": "Qt annotation macros masked; Q_SIGNALS treated as public; no semantic preprocessing"}


def self_test(parser):
    sample = '''namespace api {
class Book { void privateFn(); public: Book(); ~Book();
 void placeLimitOrder(int); void placeLimitOrder(double);
 void cancelOrder() { helper(); struct Local { void neverCollect(); }; }
 protected: void protectedFn(); private: void secret(); };
struct Public { void get_balance(); int (*callback)(int); int value;
 struct Child { void nestedMethod(); }; };
namespace detail { void implementationOnly(); }
namespace nested::detail { void anotherImplementation(); }
void publicFreeFunction(int x = anotherCall());
template<class T> T publicTemplate(T value) { return helper(value); }
}'''
    rows, _ = declarations(sample, "boost-fixture", "include/boost/fixture/test.hpp", "0"*40, parser)
    expected = {"placeLimitOrder", "cancelOrder", "get_balance", "nestedMethod", "publicFreeFunction", "publicTemplate"}
    assert {row["method"] for row in rows} == expected, rows
    assert len(rows) == len(expected), rows
    # Real Boost.MultiIndex counterexample: BOOST_TRY/CATCH in an inline body
    # makes tree-sitter close its containing class prematurely. The independent
    # lexical scope guard must reject the recovered private member as a free fn.
    broken = '''namespace api { class Book { public:
Book() { BOOST_TRY { int x; } BOOST_CATCH(...) {} BOOST_CATCH_END }
private: void secret() {} }; void actualFreeFunction(); }'''
    rows, _ = declarations(broken, "boost-fixture", "include/boost/fixture/test.hpp", "0"*40, parser)
    assert "secret" not in {row["method"] for row in rows}, rows
    assert "Book" not in {row["method"] for row in rows}, rows
    # Lexical braces inside raw strings and preprocessor macro bodies cannot
    # affect scope, even when they contain otherwise confusing C++ text.
    with_literals = '''#define BAD_MACRO { \\\n+    } {
namespace api { struct Public {
 void allowed() { auto x = R"tag( } { )tag"; }
private: void secret(); }; }'''
    rows, _ = declarations(with_literals, "boost-fixture", "include/boost/fixture/test.hpp", "0"*40, parser)
    assert {row["method"] for row in rows} == {"allowed"}, rows
    assert synopsis("/* vector synopsis\nnamespace std { void swap(); } */")[0].count("swap") == 1
    qt = '''QT_BEGIN_NAMESPACE
class Q_CORE_EXPORT Device { Q_OBJECT
public: Q_INVOKABLE void waitForReadyRead();
public Q_SLOTS: void setObjectName(const char*);
Q_SIGNALS: void readyRead();
private: void secret(); Q_PROPERTY(int value READ value)
}; QT_END_NAMESPACE'''
    rows, _ = declarations(qt_declaration_view(qt), "qt-core", "src/corelib/qfixture.h", "0"*40, parser)
    assert {row["method"] for row in rows} == {"waitForReadyRead", "setObjectName", "readyRead"}, rows
    reference = '''<pre>class name is implementation defined
{ public: typedef implementation defined iterator;
iterator insert(const value_type&amp;); void erase(iterator);
template&lt;typename Modifier&gt; bool modify(iterator,Modifier);
private: void hidden();
};</pre><pre>object.insert(value);</pre>'''
    rows, _ = documented_index_synopses(reference, "doc/reference/ord_indices.html", "0"*40, parser)
    assert {row["method"] for row in rows} == {"insert", "erase", "modify"}, rows
    print("C++ declaration extractor fixtures passed", file=sys.stderr)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--refresh", action="store_true")
    cli.add_argument("--self-test", action="store_true")
    args = cli.parse_args()
    parser = setup_parser()
    self_test(parser)
    if args.self_test:
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    previous = json.loads(META.read_text()).get("sources", {}) if META.exists() else {}
    records, metadata = [], {}
    licenses = HERE / "licenses"
    licenses.mkdir(exist_ok=True)
    for source, (repo, license_name) in SOURCES.items():
        old = previous.get(source, {})
        revision = revision_for(source, repo, old, args.refresh)
        if source == "libcxx":
            rows, files, stats, license_path, license_data = collect_libcxx(revision, parser)
            details = {"download_kind": "pinned raw public standard-library headers; synopsis blocks only"}
        elif source.startswith("qt-"):
            rows, files, stats, license_path, license_data, details = collect_qt(source, revision, parser)
        else:
            rows, files, stats, license_path, license_data, details = collect_boost(source, repo, revision, parser, old)
            details["download_kind"] = "pinned module archive; public include headers only"
            if source == "boost-multi_index":
                required = {"insert", "erase", "modify", "find", "lower_bound", "upper_bound", "equal_range"}
                if not required <= {row["method"] for row in rows}:
                    raise ValueError("Documented MultiIndex public API contract was not recovered")
        digest = sha(json.dumps(files, sort_keys=True).encode())
        if old.get("revision") == revision and old.get("extractor_version") == EXTRACTOR_VERSION and old.get("files_sha256") != digest:
            raise ValueError(f"Pinned source changed: {source}")
        if old.get("revision") == revision and old.get("license_sha256") != sha(license_data):
            raise ValueError(f"Pinned license changed: {source}")
        (licenses / f"{source}-{Path(license_path).name}").write_bytes(license_data)
        rows.sort(key=lambda row: (row["service"], row["method"], row["path"]))
        records.extend(rows)
        license_repo = details.get("license_repository", repo)
        license_revision = details.get("license_revision", revision)
        metadata[source] = dict(repository=repo, url=f"https://github.com/{repo}", revision=revision,
            ecosystem="cpp", provider="llvm" if source == "libcxx" else "qt" if source.startswith("qt-") else "boost",
            license=license_name, license_url=f"https://github.com/{license_repo}/blob/{license_revision}/{license_path}",
            license_sha256=sha(license_data), files=files, files_sha256=digest,
            extractor_version=EXTRACTOR_VERSION,
            records=len(rows), unique_methods=len({row["method"] for row in rows}),
            services=len({row["service"] for row in rows}), split_groups=len({row["split_group"] for row in rows}),
            extraction_statistics=dict(stats), **details)
        if not rows:
            raise ValueError(f"No public declarations extracted from {source}")
        print(f"{source}: {len(rows)} records, {metadata[source]['unique_methods']} names", file=sys.stderr)
    OUT.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in records))
    result = {"purpose": "Pinned public C++ declarations supplement, with exact original method spellings",
        "downloaded_code_executed": False, "parser_versions": VERSIONS,
        "sources": metadata, "corpus_sha256": sha(OUT.read_bytes()), "records": len(records),
        "limitations": [
            "Tree-sitter parses declarations but performs no name lookup, preprocessing, overload resolution or export analysis.",
            "All conditional branches may contribute identifiers; overloads coalesce per service/file, not across headers.",
            "libc++ uses official header synopsis blocks only, which are a partial evolving standard-library specification; implementation names are excluded.",
            "Boost uses public include paths and class access labels; detail/impl/aux/private/protected and anonymous namespaces are excluded, but undocumented public helpers can remain.",
            "Explicit parser ERROR subtrees are excluded, so macro-heavy and pseudo-code declarations can be undercounted.",
            "An independent comment/string/directive-aware brace-depth guard rejects declarations when recovered AST scope disagrees with lexical scope; conditional brace alternatives and extern linkage blocks can cause conservative omissions.",
            "Boost.MultiIndex index implementations live in detail namespaces and are intentionally omitted; macro-heavy inline bodies can invalidate class parsing. This corpus is not complete MultiIndex API coverage.",
            "MultiIndex is supplemented by its five official index-reference class synopses: unspecified class/type placeholders are normalized solely for parsing, while every method spelling is retained unchanged. Example/call blocks are excluded.",
            "Constructors, destructors, symbolic/conversion operators, function-pointer fields and non-ASCII identifiers are excluded; their source spellings do not map to ordinary method-name identifiers.",
            "Inline bodies are not visited, preventing calls and local declarations from becoming API records.",
            "Qt Core/Network headers omit _p/_p_p/_impl files and explicit private-API warnings; annotation macros are masked, not semantically expanded, so conditional or undocumented public declarations may remain.",
            "Qt per-header SPDX license expressions and all project license texts are preserved separately; no uniform license is inferred.",
            "This is one STL implementation, ten Boost components and two Qt modules, not an estimate of all C++ APIs."
        ]}
    META.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"records":len(records), "unique_methods":len({row['method'] for row in records}),
                      "sha256": result["corpus_sha256"]}))


if __name__ == "__main__":
    main()
