#!/usr/bin/env python3
"""Read-only source inventory for the proposed JavaScript ActionName adoption.

The exact measurements below count current source lines/anchors. Future LOC
figures are explicitly engineering estimates, not a synthetic diff or a promise
that every nearby line must change. No production file is rewritten.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
COMMON = 'packages/user/CommonApi/common/packages/common-lib/'


def anchors(path, sites):
    raw = (ROOT / path).read_bytes()
    lines = raw.decode().splitlines()
    records = []
    for line, expected, purpose in sites:
        assert expected in lines[line - 1], (path, line, expected)
        records.append({'line': line, 'source': lines[line - 1], 'purpose': purpose})
    return {'path': path, 'sha256': hashlib.sha256(raw).hexdigest(), 'anchors': records}


def main():
    result = subprocess.run(['rg', '--files', 'packages', 'libraries', 'rust',
                             '-g', '*.ts', '-g', '*.tsx', '-g', '*.js', '-g', '*.mjs',
                             '-g', '!**/node_modules/**', '-g', '!**/dist/**',
                             '-g', '!**/target/**', '-g', '!**/wasm-transpiled/**'],
                            cwd=ROOT, capture_output=True, text=True, check=True)
    paths = sorted(result.stdout.splitlines())
    pattern = re.compile(r'\b(?:MethodNumber|method_to_number|methodToNumber|numberToMethod|method_number|method_number_to_string|psibase_names)\b')
    references = []
    for path in paths:
        for number, line in enumerate((ROOT / path).read_text().splitlines(), 1):
            if pattern.search(line):
                references.append({'path': path, 'line': number, 'source': line})
    groups = {
        'additive_package_integration': [
            anchors(COMMON + 'src/index.ts', [(6, './websocket', 'Optional root export for new ActionName module')]),
            anchors(COMMON + 'package.json', [(9, '"exports"', 'New action-name subpath'),
                                              (46, '"build"', 'Codec conformance-test command/build integration')]),
            anchors(COMMON + 'vite.config.ts', [(12, 'entry:', 'Dedicated tree-shakable codec entry'),
                                               (14, 'fileName:', 'Preserve current UMD/ESM entry names')]),
        ],
        'central_transaction_and_json_boundaries': [
            anchors(COMMON + 'src/rpc.ts', [
                (137, 'JSON.stringify(json)', 'BigInt cannot be sent to JSON implicitly; use explicit ActionName text/ID representation'),
                (202, 'function packAction', 'Central optional ActionName input adapter'),
                (203, 'sender, service, method', 'Normalize typed input once'),
                (211, '"/pack_action/" + method', 'Keep argument-schema lookup separate from numeric identity'),
                (218, 'return { sender, service, method, rawData }', 'JSON representation selected by explicit codec contract'),
                (227, 'function packTransaction', 'Native generic transaction packing'),
                (229, '"/common/pack/Transaction"', 'Native schema currently owns method encoding'),
                (232, 'packActions', 'One shared adapter covers callers'),
            ]),
        ],
        'onchain_method_text_declarations': [
            anchors(COMMON + 'src/rpc.ts', [(27, 'method: string', 'GetClaimParams legacy public text API')]),
            anchors('packages/user/Explorer/ui/src/lib/types.ts', [(9, 'method: string', 'Public Action JSON remains canonical text')]),
            anchors('packages/local/XAdmin/ui/src/lib/action-stack.ts', [(5, 'method: string', 'Decoded trace method text')]),
            anchors('packages/user/Config/ui/src/lib/get-staged-tx.ts', [(17, 'method: z.string()', 'Staged transaction method text')]),
        ],
        'display_and_projection_examples': [
            anchors('packages/user/Explorer/ui/src/components/action-chips.tsx', [
                (19, 'method: string', 'MethodChip presentation input'),
                (38, '{method}', 'Visible canonical method label'),
                (56, 'method={a.method}', 'Action method label'),
                (69, 'a.service}::{a.method', 'Overflow label'),
            ]),
            anchors('packages/user/Explorer/ui/src/pages/transaction-detail.tsx', [(228, 'method={action.method}', 'Transaction action label')]),
            anchors('packages/user/Explorer/ui/src/pages/account.tsx', [(144, 'm.set(a.method', 'Method activity aggregation')]),
            anchors('packages/user/Explorer/ui/src/hooks/use-user-dashboard.ts', [
                (141, 'method: string', 'Dashboard public activity type'),
                (203, 'a.service}::${a.method', 'Activity aggregation key'),
            ]),
            anchors('packages/user/Config/ui/src/pages/pending-transaction.tsx', [(270, '{action.method}', 'Pending action label')]),
            anchors('packages/local/XAdmin/ui/src/components/progress-status.tsx', [(15, 'act.service}::${act.method}', 'Bootstrap error trace label')]),
        ],
        'explicitly_not_onchain_method_ids': [
            anchors('packages/user/Supervisor/ui/src/main.ts', [(52, 'WIT kebab-case', 'Plugin export canonicalization'),
                                                                 (60, 'camelToKebab(args.method)', 'Keep this string-based WIT dispatch unchanged')]),
            anchors(COMMON + 'src/messaging/function-call-request.ts', [(7, 'method: string', 'Supervisor plugin/WIT function, not action numeric ID')]),
            anchors('packages/user/Supervisor/ui/src/component-loading/loader.ts', [(185, 'method: rawMethodName', 'Resource export dispatch, not on-chain action name')]),
            anchors('packages/user/Supervisor/ui/src/host-interface.ts', [(9, 'method: string', 'HTTP request method, not action numeric ID')]),
            anchors('packages/shared-ui/lib/schemas/account.ts', [(72, 'zAccountNumber = z.string()', 'Account-name validation remains a separate identity type')]),
        ],
        'existing_bigint_and_wasm_examples': [
            anchors('packages/user/CommonApi/common/packages/plugin-tester/ui/src/components/inputs/number-input.tsx', [(9, 'number | bigint', 'Existing generated u64 plugin inputs support bigint'),
                                                                                                                      (27, 'BigInt(newValue)', 'Do not introduce Number conversion')]),
            anchors('packages/local/XAdmin/ui/src/lib/chain-endpoints.ts', [(294, 'util.deserializeTrace', 'Native Rust/WASM decoder already yields method JSON text')]),
        ],
    }
    totals = {name: {'files': len(files), 'distinct_source_lines': sum(len(row['anchors']) for row in files)}
              for name, files in groups.items()}
    output = {
        'scope': 'Read-only JS/TS source audit for new parallel action_name; no production edits',
        'counting': 'rg --files in packages/libraries/rust for ts/tsx/js/mjs, respecting ignore rules and excluding node_modules/dist/target/wasm-transpiled; semantic anchors are a curated implementation inventory, not a bulk replacement list',
        'scanned_js_ts_source_files': len(paths),
        'current_direct_legacy_codec_references': references,
        'current_direct_legacy_codec_reference_count': len(references),
        'measured_group_totals': totals,
        'groups': groups,
        'implementation_estimates': {
            'units': 'Handwritten source lines added or edited; prospective ranges, not measured diffs. Generated tables/vectors and native Rust/C++ changes excluded.',
            'additive_codec_type': {
                'new_production_lines': [350, 650],
                'new_test_lines': [250, 450],
                'existing_packaging_lines_added_or_edited': [12, 30],
                'existing_files': 3,
                'new_handwritten_files': [2, 4],
                'required_existing_application_callsite_edits': 0,
                'assumption': 'Expose a separate pure JS/TS action-name codec and BigInt wrapper without changing existing account-name or legacy method/string APIs.'
            },
            'central_typed_rpc_adoption': {
                'additional_production_lines_added_or_edited': [30, 70],
                'additional_test_lines': [80, 160],
                'existing_production_files': 1,
                'required_existing_application_callsite_edits': 0,
                'assumption': 'Extend packAction input to ActionName through one normalization point; continue canonical method-text JSON and let explicit native schema/service format choose numeric codec.'
            },
            'optional_numeric_or_dual_format_public_json': {
                'additional_lines_added_or_edited': [60, 140],
                'existing_files': [5, 9],
                'assumption': 'Only needed if public action JSON adds codec IDs/numeric metadata. Preserve method display text to avoid unnecessary broad UI changes. Exact delta requires the chosen JSON version contract.'
            },
            'generated_model_assets': 'Count generated CDF/dictionary tables, byte size and golden-vector count separately from handwritten LOC; a static per-model asset/module can be cached and shared once.'
        },
        'adoption_recommendations': [
            'Provide ActionName/action_name as a separate branded bigint or immutable bigint wrapper, with encode/decode, explicit canonical text/JSON conversion and exact 8-byte little-endian helpers. Do not accept lossy Number values.',
            'Keep current AccountNumber/account string validation and legacy MethodNumber identity separate. A u64 tag space does not establish that new numeric values cannot overlap legacy IDs.',
            'Do not rename generic Supervisor/plugin WIT method strings or HTTP method fields. New native WIT u64 entry points should map through the existing generated component machinery to bigint.',
            'Use one frozen generator output for integer CDFs/dictionary/tokenization tie rules and golden vectors in all languages. JavaScript bitwise operators have signed32 semantics; use exact BigInt arithmetic or explicitly proved safe integer operations.',
            'Specify hash fallback and exact literal validation before claiming a complete codec. Keep its canonical input/output and digest truncation identical across languages.',
            'Keep payload serialization distinct from argument-schema lookup. Generic current JS clients ask native /pack_action and /common/pack/Transaction endpoints to encode methods; preserve canonical text for those clients or add an explicitly versioned endpoint.',
            'Carry a model/format fingerprint in development build/network metadata and refuse stale-model typed submissions. Retain exact model files for historical action interpretation; never infer old/new codec solely from a numeric ID.',
            'Export a dedicated action-name module/subpath with separately measured bundled asset size. Test Node plus a real browser, 64-bit boundaries, EOS overflow, digits/underscores, mode tags, malformed literals, and shared Rust/C++/JS golden vectors.',
        ],
    }
    destination = HERE / 'adoption-js-audit.json'
    destination.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'scanned_files': len(paths), 'legacy_codec_references': len(references), 'measured_group_totals': totals}))


if __name__ == '__main__':
    main()
