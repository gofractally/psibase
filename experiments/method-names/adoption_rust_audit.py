#!/usr/bin/env python3
"""Read-only Rust action_name source inventory and explicitly estimated effort.

Counts are source reference/registration lines, not an implemented patch or a
claim that every matching line must change. No production source is rewritten.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOKENS = re.compile(r'\b(?:MethodNumber|MethodString|method_raw|method_number_from_str|method_number_to_string)\b')
RAW_STRING = re.compile(r'(?:br|r)(#*)"')
CHARACTER = re.compile(r"'(?:\\.|[^'\\])'")
LEGACY = {'rust/psibase/src/method_number.rs', 'rust/psibase_names/src/method_number.rs'}
EVENT_ONLY = {'rust/psibase/src/services/events.rs', 'rust/psibase/src/graph_ql.rs',
              'rust/psibase_macros/psibase-macros-lib/src/service_macro/events.rs',
              'rust/psibase_macros/psibase-macros-lib/src/service_macro/graphql.rs'}


def comments_masked(text):
    """Hide nested Rust comments while preserving offsets and string literals."""
    chars = list(text)
    i = 0
    while i < len(text):
        raw = RAW_STRING.match(text, i)
        if raw:
            end = text.find('"' + raw[1], raw.end())
            i = len(text) if end < 0 else end + 1 + len(raw[1])
        elif text[i] == '"':
            i += 1
            while i < len(text):
                if text[i] == '\\': i += 2
                elif text[i] == '"': i += 1; break
                else: i += 1
        elif text.startswith('//', i):
            end = text.find('\n', i)
            if end < 0: end = len(text)
            chars[i:end] = ' ' * (end - i)
            i = end
        elif text.startswith('/*', i):
            begin, depth = i, 1
            i += 2
            while i < len(text) and depth:
                if text.startswith('/*', i): depth += 1; i += 2
                elif text.startswith('*/', i): depth -= 1; i += 2
                else: i += 1
            chars[begin:i] = ['\n' if char == '\n' else ' ' for char in text[begin:i]]
        else:
            character = CHARACTER.match(text, i)
            i = character.end() if character else i + 1
    return ''.join(chars)


def main():
    assert comments_masked('"//MethodNumber" // MethodNumber\n/* a /* b */ c */MethodNumber').endswith('MethodNumber')
    files, attrs, manual, typed = [], [], [], []
    hashes = {}
    for base in ('rust', 'packages'):
        for path in sorted((ROOT / base).rglob('*.rs')):
            if path.name == 'bindings.rs' or any(part in path.parts for part in ('target', 'node_modules', 'dist')):
                continue
            original = path.read_text(errors='replace')
            original_lines = original.splitlines()
            text = comments_masked(original)
            relative = str(path.relative_to(ROOT))
            lines = []
            for number, line in enumerate(text.splitlines(), 1):
                tokens = TOKENS.findall(line)
                if tokens:
                    lines.append({'line': number, 'tokens': tokens, 'source': original_lines[number - 1].strip()})
            if lines:
                files.append({'path': relative, 'reference_lines': len(lines),
                              'retained_legacy_implementation': relative in LEGACY,
                              'event_only_reference_file': relative in EVENT_ONLY, 'lines': lines})
            for match in re.finditer(r'#\[psibase::service(?=\s*[\](])', text):
                attrs.append({'path': relative, 'line': text.count('\n', 0, match.start()) + 1})
            if base == 'packages':
                for match in re.finditer(r'(?<!fn )\badd_action_to_transaction\s*\(', text):
                    argument = text[match.end():].split(',', 1)[0].strip()
                    category = ('generated_ACTION_NAME' if 'ACTION_NAME' in argument else
                                'literal' if re.match(r'^&?\s*"', argument) else 'runtime_or_wrapper')
                    manual.append({'path': relative, 'line': text.count('\n', 0, match.start()) + 1,
                                   'category': category})
                for match in re.finditer(r'(?:\.|::)add_to_tx\s*\(', text):
                    typed.append({'path': relative, 'line': text.count('\n', 0, match.start()) + 1})
            if lines or any(item['path'] == relative for item in attrs + manual + typed):
                hashes[relative] = hashlib.sha256(path.read_bytes()).hexdigest()

    total = sum(row['reference_lines'] for row in files)
    retained = sum(row['reference_lines'] for row in files if row['retained_legacy_implementation'])
    event_only = sum(row['reference_lines'] for row in files if row['event_only_reference_file'])
    report = {
        'scope': 'Read-only Rust source inventory; exact static line counts and separate planning estimates; no production edits',
        'counting': 'rust/**/*.rs and packages/**/*.rs; target/node_modules/dist/bindings.rs excluded; nested comments hidden, string literals retained; unique source lines counted once per category',
        'measured': {
            'legacy_name_reference_lines': total,
            'legacy_name_reference_files': len(files),
            'retained_legacy_implementation_reference_lines': retained,
            'event_only_reference_lines': event_only,
            'remaining_action_or_mixed_candidate_reference_lines': total - retained - event_only,
            'remaining_action_or_mixed_candidate_files': sum(not row['retained_legacy_implementation'] and not row['event_only_reference_file'] for row in files),
            'service_registration_attributes': len(attrs), 'service_registration_files': len({row['path'] for row in attrs}),
            'package_service_registration_attributes': sum(row['path'].startswith('packages/') for row in attrs),
            'manual_add_action_calls': len(manual), 'manual_add_action_files': len({row['path'] for row in manual}),
            'manual_call_categories': dict(Counter(row['category'] for row in manual)),
            'typed_add_to_tx_expressions': len(typed), 'typed_add_to_tx_files': len({row['path'] for row in typed}),
            'manual_and_typed_union_files': len({row['path'] for row in manual + typed}),
        },
        'interpretation': [
            'A parallel ActionName type does not require renaming all MethodNumber references; legacy implementations and golden tests should remain.',
            'Reference lines are review anchors, not a measured final diff. Type aliases, imports, helper bodies, trait signatures and tests have different implementation costs.',
            'Rust action bodies and action function names do not need editing when central procedural macros choose the new codec.',
            'Typed add_to_tx users can benefit from one central numeric-transport change. Manual call expressions can retain source spellings if string entry points resolve a service codec version.',
            'Service-registration attributes are a possible one-line opt-in cost per service module, not mandatory if a network-wide profile is selected by build configuration.',
            'Mixed schema/action/event files require semantic review. Event-only files may stay legacy in an action-only phase.',
        ],
        'anchors': [
            {'path': 'rust/psibase_names/src/lib.rs', 'line': 17, 'purpose': 'Export new action_name functions/model alongside legacy modules'},
            {'path': 'rust/psibase/src/lib.rs', 'line': 64, 'purpose': 'Export new ActionName wrapper alongside MethodNumber'},
            {'path': 'rust/psibase/src/method_number.rs', 'line': 25, 'purpose': 'Wrapper pattern: u64 Pack/Unpack/ToKey/ToSchema, string serialization and GraphQL scalar; retain old file'},
            {'path': 'rust/psibase/src/internal_macros.rs', 'line': 1, 'purpose': 'serialize_as_str macro can support separate ActionName parser/display'},
            {'path': 'rust/psibase_macros/psibase-macros-derive/src/number_macro.rs', 'line': 20, 'purpose': 'Add separate action_name/action_name_raw compile-time encoders with strict validation'},
            {'path': 'rust/psibase_macros/psibase-macros-lib/src/service_macro/actions.rs', 'line': 108, 'purpose': 'Central generated ACTION_NAME string and future numeric ACTION_ID/version constant'},
            {'path': 'rust/psibase_macros/psibase-macros-lib/src/service_macro/actions.rs', 'line': 133, 'purpose': 'Central action caller numeric-ID generation'},
            {'path': 'rust/psibase_macros/psibase-macros-lib/src/service_macro/dispatch.rs', 'line': 30, 'purpose': 'Action dispatch ID generation; add duplicate-ID rejection including legacy aliases'},
            {'path': 'rust/psibase/src/block.rs', 'line': 50, 'purpose': 'Action.method and SharedAction.method semantic type; on-wire field remains u64'},
            {'path': 'rust/psibase/src/service.rs', 'line': 103, 'purpose': 'Caller trait and implementations carry method IDs'},
            {'path': 'rust/psibase/src/schema.rs', 'line': 14, 'purpose': 'MethodString equality/hash currently encode with legacy codec; split action/event key interpretation'},
            {'path': 'rust/psibase/src/schema.rs', 'line': 348, 'purpose': 'Separate ActionName custom handler and schema tag; preserve MethodNumber legacy handler'},
            {'path': 'rust/psibase_plugin/src/wasm/transact.rs', 'line': 18, 'purpose': 'Avoid numeric->debug string->numeric roundtrip by adding exact u64 transport'},
            {'path': 'packages/system/Transact/plugin/transact/wit/world.wit', 'line': 68, 'purpose': 'Shared cross-language string-only add-action boundary; add numeric/version-aware entry point'},
            {'path': 'packages/system/Transact/plugin/transact/src/lib.rs', 'line': 177, 'purpose': 'ImportAction.method string currently re-encodes using legacy MethodNumber'},
            {'path': 'packages/system/AuthSig/plugin/src/lib.rs', 'line': 66, 'purpose': 'Sender hook currently compares raw camelCase string; compare stable numeric ID/version'},
            {'path': 'packages/user/Invite/plugin/src/lib.rs', 'line': 268, 'purpose': 'Sender hook numeric comparison currently parses with legacy MethodNumber'},
            {'path': 'packages/system/Credentials/service/src/tables.rs', 'line': 68, 'purpose': 'Persistent allowed_actions method-ID permissions; retain intended action binding across migration'},
            {'path': 'rust/psibase/src/native_tables.rs', 'line': 411, 'purpose': 'ServiceMethod native table representation of persisted method IDs'},
            {'path': 'rust/psibase/src/services/events.rs', 'line': 27, 'purpose': 'Event/index IDs remain legacy unless a separate event migration is intended'},
        ],
        'planning_estimates_not_measured_diff': {
            'additive_codec_type_phase': {
                'new_handwritten_implementation_lines_low': 500, 'new_handwritten_implementation_lines_high': 850,
                'new_test_harness_lines_low': 250, 'new_test_harness_lines_high': 450,
                'existing_file_integration_added_or_changed_lines_low': 50, 'existing_file_integration_added_or_changed_lines_high': 100,
                'existing_file_count_low': 5, 'existing_file_count_high': 8,
                'new_handwritten_file_count_low': 4, 'new_handwritten_file_count_high': 7,
                'notes': 'Independent Rust codec, strict parser/hash fallback, deterministic segmentation, ActionName wrapper/macros/schema custom type, golden/property tests; generated model tables/vectors excluded. Existing action behavior stays legacy.'},
            'numeric_transport_and_opt_in_action_phase': {
                'additional_existing_lines_low': 150, 'additional_existing_lines_high': 300,
                'existing_file_count_low': 8, 'existing_file_count_high': 14,
                'notes': 'Caller/dispatch opt-in selection, exact-u64 Transact WIT path and authorization hooks, schema metadata and action JSON support, integration tests. WIT is cross-language shared work; deduplicate in cross-language totals.'},
            'full_action_adoption_phase': {
                'existing_lines_low': 250, 'existing_lines_high': 500,
                'notes': 'Total planning range after additive implementation, including central action/schema/client migration and manual literal/permission review. Registration attrs may add up to measured count of one-line opt-ins. Does not include new handwritten codec/tests or generated model files. Exact final diff requires implementation.'},
            'generated_data_lines': 'Not estimated as LOC: depend on formatting. Budget binary table bytes, token count, golden vector count, native/wasm size and CPU separately.'},
        'recommendation': {
            'type': 'Rust ActionName mirrors proposed C++ action_name and JavaScript ActionName; keep legacy MethodNumber and AccountNumber independent',
            'abi': 'Same eight-byte storage does not make identities compatible. New tag bits can overlap valid legacy IDs. Select codec/model through network/service/schema version, not guessed from a bare u64.',
            'history': 'Freeze legacy decoders and old model snapshots; old staged actions/events/native permissions require original numeric semantics. Service alias dispatch needs cross-alias duplicate checks.',
            'development': 'Model/weight changes alter generated action IDs. Lock all Rust const/proc-macro/runtime conversion to the same checked-in model hash; regenerate native/wasm/JS/C++ together; do not silently use a newly trained table for a persisted ID.',
            'runtime': 'Keep dispatch as exact u64 comparison. Do not run arithmetic coding or dictionary search in the dispatch hot path.'},
        'reference_inventory': files, 'service_registration_inventory': attrs,
        'manual_add_action_inventory': manual, 'typed_add_to_tx_inventory': typed,
        'source_sha256': dict(sorted(hashes.items())),
    }
    destination = HERE / 'adoption-rust-audit.json'
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['measured'], indent=2))
    print('Saved', destination)


if __name__ == '__main__':
    main()
