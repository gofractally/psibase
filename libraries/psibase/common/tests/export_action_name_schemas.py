#!/usr/bin/env python3
"""Build actual C++ service-interface schemas without executable WASM packages.

Only C++ headers with a class-local static service constant are included. This
is structural ABI evidence, not a replacement for packaged-service execution.
Missing Rust-only interfaces remain explicitly uncovered by this exporter.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]


def declarations(path):
    text = path.read_text()
    clean = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/',
                   lambda match: re.sub(r'[^\n]', ' ', match[0]), text)

    def body_end(opening):
        depth = 1
        cursor = opening + 1
        while cursor < len(clean) and depth:
            depth += (clean[cursor] == '{') - (clean[cursor] == '}')
            cursor += 1
        if depth:
            raise ValueError(f'Unbalanced declaration in {path}')
        return cursor

    namespaces = [(match.start(), body_end(match.end() - 1), match[1]) for match in
                  re.finditer(r'\bnamespace\s+([A-Za-z_]\w*(?:::\w+)*)\s*\{', clean)]
    classes = [(match.start(), body_end(match.end() - 1), match[1]) for match in
               re.finditer(r'\b(?:class|struct)\s+([A-Za-z_]\w*)\s*(?::[^;{]+)?\{', clean)]
    result = set()
    for service in re.finditer(r'\bstatic\s+constexpr\b[^;{}]*\bservice\s*=', clean):
        parents = [entry for entry in classes if entry[0] < service.start() < entry[1]]
        if not parents:
            continue
        owner = max(parents, key=lambda entry: entry[0])
        scope = [name for begin, end, name in namespaces if begin < owner[0] < end]
        result.add('::'.join(scope + [owner[2]]))
    return sorted(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--compiler', default='c++')
    parser.add_argument('--include', action='append', default=[])
    parser.add_argument('--service', action='append', help='Restrict to a C++ qualified class name')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.build.mkdir(parents=True, exist_ok=True)
    interfaces = []
    for path in sorted((ROOT / 'packages').glob('*/*/include/services/**/*.hpp')):
        # Build an include token relative to the owning package include root.
        include_root = next(parent for parent in path.parents if parent.name == 'include')
        for name in declarations(path):
            if args.service and name not in args.service:
                continue
            interfaces.append({'class': name, 'header': str(path.relative_to(include_root)),
                               'include_root': str(include_root), 'source': str(path.relative_to(ROOT)),
                               'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    if not interfaces:
        parser.error('No C++ service declarations selected')
    source = ['#include <psibase/schema.hpp>', '#include <psio/to_json.hpp>',
              '#include <fstream>', '#include <iostream>', '#include <filesystem>']
    source += [f'#include <{name}>' for name in sorted({row['header'] for row in interfaces})]
    source += ['template<class T> void save(const char* directory) {',
               'auto schema = psibase::ServiceSchema::make<T>();',
               'auto file = std::filesystem::path(directory) / (schema.service.str() + ".json");',
               'auto temporary = file; temporary += ".tmp";',
               '{ std::ofstream out(temporary); out << psio::convert_to_json(schema);',
               'if (!out) throw std::runtime_error("Could not write schema fixture"); }',
               'std::filesystem::rename(temporary, file);',
               'std::cout << schema.service.str() << "\\n"; }',
               'int main(int argc, char** argv) { if(argc != 2) return 2;',
               'if(std::string_view(argv[1]) == "--model-hash") { std::cout << psio::action_names::model_sha256; return 0; }']
    source += [f'save<{row["class"]}>(argv[1]);' for row in interfaces]
    source += ['}']
    cpp = args.build / 'export_service_schemas.cpp'
    cpp.write_text('\n'.join(source) + '\n')
    executable = args.build / 'export-service-schemas'
    command = [args.compiler, '-std=c++23', '-O1', '-I' + str(ROOT / 'libraries/psio/include'),
               '-I' + str(ROOT / 'libraries/psibase/common/include')]
    command += ['-I' + path for path in sorted({row['include_root'] for row in interfaces} | set(args.include))]
    fpconv = args.build / 'fpconv.o'
    subprocess.run([args.compiler, '-x', 'c', '-O1', '-I' + str(ROOT / 'libraries/psio/include'),
                    '-c', str(ROOT / 'libraries/psio/src/fpconv.c'),
                    '-o', str(fpconv)], check=True)
    command += [str(cpp)] + [str(ROOT / 'libraries/psio/src' / name)
                            for name in ('schema.cpp', 'chrono.cpp', 'from_json.cpp')] + [str(fpconv)]
    command += ['-o', str(executable)]
    print(f'Compiling {len(interfaces)} actual C++ service-interface schemas', flush=True)
    subprocess.run(command, check=True)
    names = subprocess.check_output([str(executable), str(args.output)], text=True).splitlines()
    assert len(names) == len(set(names)), 'Duplicate service output names'
    evidence = {'scope': 'Actual C++ interface schemas; no executable package verification claimed',
                'model_sha256': subprocess.check_output([str(executable), '--model-hash'], text=True).strip(),
                'interfaces': interfaces, 'services': sorted(names),
                'schema_sha256': {name: hashlib.sha256((args.output / (name + '.json')).read_bytes()).hexdigest()
                                  for name in sorted(names)}}
    (args.output / 'manifest.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'exported': len(names), 'services': sorted(names)}), flush=True)


if __name__ == '__main__':
    main()
