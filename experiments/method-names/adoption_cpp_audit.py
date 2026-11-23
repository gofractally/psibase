#!/usr/bin/env python3
"""Reproducible source-line census and explicit C++ adoption planning estimates.

This is an inventory, not a generated patch or an assertion that every match
must change. It preserves legacy codec/tests and distinguishes event-ID work.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DIRECT = re.compile(r'\b(?:MethodNumber|CompareMethodNumber)\b|"(?:\\.|[^"\\])*"_m\b')
DEPENDENT = re.compile(r'\bServiceMethod\b')
LEGACY = {
    'libraries/psibase/common/include/psibase/MethodNumber.hpp',
    'libraries/psibase/common/tests/name.cpp',
}
UNUSED_INCLUDES = {
    'packages/user/Tokens/include/services/user/tokenTables.hpp',
    'packages/user/Tokens/test/src/Tokens-test.cpp',
}
# Existing event codec and comparator remain legacy in action-only rollout.
PRESERVE_EVENT_LINES = {
    'libraries/psibase/common/include/psibase/Actor.hpp': {233},
    'libraries/psibase/common/include/psibase/schema.hpp': {18, 23, 88, 419},
    'packages/system/AuthSig/src/AuthSig.cpp': {301, 302, 307, 308},
    'packages/user/Invite/src/Invite.cpp': {77, 78},
}


def hide_comments(text):
    return re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/',
                  lambda match: re.sub(r'[^\n]', ' ', match[0]) if match[0].startswith(('//', '/*')) else match[0], text)


def stats(inventory, field):
    return {'files': sum(bool(row[field]) for row in inventory),
            'source_lines': sum(len(row[field]) for row in inventory)}


def main():
    names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard'],
                                    cwd=ROOT, text=True).splitlines()
    inventory = []
    for name in sorted(set(names)):
        path = Path(name)
        if path.suffix not in {'.hpp', '.h', '.cpp', '.cc', '.cxx', '.ipp'}:
            continue
        if path.parts[0] not in {'libraries', 'programs', 'packages'}:
            continue
        if any(part in {'external', 'node_modules', 'target', 'dist'} or part.startswith('build-') for part in path.parts):
            continue
        raw = (ROOT / path).read_bytes()
        clean = hide_comments(raw.decode(errors='replace')).splitlines()
        direct = {i for i, line in enumerate(clean, 1) if DIRECT.search(line)}
        dependent = {i for i, line in enumerate(clean, 1) if DEPENDENT.search(line)}
        if not direct and not dependent:
            continue
        action = set(direct)
        if name in LEGACY | UNUSED_INCLUDES or name.startswith('packages/user/Events/'):
            action.clear()
        action -= PRESERVE_EVENT_LINES.get(name, set())
        inventory.append({'path': name, 'sha256': hashlib.sha256(raw).hexdigest(),
                          'direct_legacy_method_lines': sorted(direct),
                          'action_cutover_candidate_lines': sorted(action),
                          'service_method_dependent_lines': sorted(dependent),
                          'direct_or_dependent_lines': sorted(direct | dependent)})
    result = {
        'scope': 'C++ audit only; no production code changed',
        'counting_method': 'Distinct physical source lines in tracked or unignored C++ sources under libraries/programs/packages; comments hidden, string/include literals retained; each file/line counted once per category',
        'interpretation': 'Measured references are change candidates and review surfaces, not precise patch LOC. Estimates below are manually scoped planning ranges; new generated data is excluded.',
        'measured': {field: stats(inventory, field) for field in
                     ('direct_legacy_method_lines', 'action_cutover_candidate_lines',
                      'service_method_dependent_lines', 'direct_or_dependent_lines')},
        'preserved_legacy_files': sorted(LEGACY),
        'event_only_file_inventory': [row['path'] for row in inventory if row['path'].startswith('packages/user/Events/')],
        'event_only_direct_reference_lines': sum(len(row['direct_legacy_method_lines']) for row in inventory if row['path'].startswith('packages/user/Events/')),
        'unused_include_files_not_required_for_adoption': sorted(UNUSED_INCLUDES),
        'preserved_mixed_event_lines': {name: sorted(lines) for name, lines in PRESERVE_EVENT_LINES.items()},
        'phases': [
            {'name': 'Add parallel type and codec; no action cutover',
             'existing_files_estimate': [2, 4], 'existing_lines_modified_or_added_estimate': [4, 12],
             'new_handwritten_cpp_lines_estimate': [650, 1050],
             'new_cpp_test_lines_estimate': [250, 450],
             'generated_model_data_lines': 'Report separately after generator is selected; array formatting does not measure implementation size',
             'concrete_existing_anchors': [
                 {'path': 'libraries/psibase/common/include/psibase/schema.hpp', 'line': 6,
                  'change': 'Add action_name header; retain legacy MethodNumber include and comparator'},
                 {'path': 'libraries/psibase/common/src/schema.cpp', 'line': 9,
                  'change': 'Register action_name custom type alongside MethodNumber'},
                 {'path': 'libraries/psibase/common/tests/CMakeLists.txt', 'line': 7,
                  'change': 'Add new action-name conformance test source to native/WASM target'}],
             'assumptions': ['Header-only constexpr-compatible codec to preserve compile-time dispatch ID generation',
                             'New ActionName.hpp with public action_name alias, explicit u64/string APIs and dedicated literal; legacy types unchanged',
                             'Integer segmentation cost tables and deterministic tie-breaking generated from one model artifact',
                             'New code estimate includes strict parser, bounded decoder, all readable branches, fallback and schema/JSON hooks']},
            {'name': 'Homogeneous development-chain action cutover, retaining legacy event IDs',
             'existing_files_estimate': [50, 65], 'existing_lines_modified_or_added_estimate': [180, 320],
             'additional_handwritten_cpp_lines_estimate': [150, 300],
             'measured_direct_candidate_lines': sum(len(row['action_cutover_candidate_lines']) for row in inventory),
             'change_groups': ['Action::method and active ServiceMethod fields',
                               'Actor generated calls and dedicated action reflection/dispatch path',
                               'Action schema comparator/codec metadata and JSON/package packing',
                               'Native system actions, callbacks, credentials and auth method comparisons',
                               'Tests and literals for adopted services'],
             'assumptions': ['Rebuild and reseed development chains when changing a model; existing persisted IDs are not silently reinterpreted',
                             'Action and ServiceMethod wrapper names can remain source-compatible while member types change in active ABI',
                             'Do not rewrite each reflected action declaration; generated Actor/reflection paths derive new IDs centrally']},
            {'name': 'Production dual-version/history support',
             'existing_lines_estimate': 'Not credibly fixed until service/envelope version strategy is selected; ServiceMethod-dependent surface listed separately',
             'additional_work': ['Archive every model and choose codec by explicit network/service ABI generation',
                                 'Preserve credentials, staged actions, callbacks and history against the codec originally used',
                                 'Audit numeric alias collisions across every accepted legacy and new dispatch table',
                                 'Event-ID migration is independently versioned, with 32 direct reference lines across 10 event-only files plus mixed call sites']}
        ],
        'key_source_anchors': [
            {'path': 'libraries/psibase/common/include/psibase/MethodNumber.hpp', 'line': 49, 'finding': 'String constructor hard-wires current codec; str() at54 uses current decoder'},
            {'path': 'libraries/psibase/common/include/psibase/block.hpp', 'line': 27, 'finding': 'Action.method is an unversioned eight-byte MethodNumber'},
            {'path': 'libraries/psibase/common/include/psibase/Actor.hpp', 'line': 48, 'finding': 'Generated action calls encode reflected name here and156; event type separately at233'},
            {'path': 'libraries/psibase/common/include/psibase/dispatch.hpp', 'line': 103, 'finding': 'Dispatch numeric member lookup must select action codec, not generic field hash'},
            {'path': 'libraries/psio/include/psio/reflect.hpp', 'line': 507, 'finding': 'Legacy numeric method lookup uses hash_name; other macros use same hash for data members'},
            {'path': 'libraries/psio/include/psio/reflect.hpp', 'line': 752, 'finding': 'Generic data-member numeric reflection must keep its old meaning'},
            {'path': 'libraries/psio/include/psio/get_type_name.hpp', 'line': 240, 'finding': 'hash_name is shared infrastructure; replacing it globally would alter more than action names'},
            {'path': 'libraries/psibase/common/include/psibase/schema.hpp', 'line': 86, 'finding': 'ActionMap and EventMap at88 share legacy comparator today; split their policies'},
            {'path': 'libraries/psibase/common/include/psibase/nativeTables.hpp', 'line': 333, 'finding': 'ServiceMethod persisted/auth data shares numeric method type'},
            {'path': 'packages/user/Events/src/REvents.cpp', 'line': 475, 'finding': 'Headerless event SQL query encodes user-supplied event string'},
            {'path': 'libraries/psibase/common/src/package.cpp', 'line': 122, 'finding': 'Headerless package/CLI JSON string method conversion requires explicit new-format selection'}
        ],
        'design_constraints': ['A using alias from MethodNumber to action_name cannot preserve both codec meanings',
                               'Strong types with explicit conversions prevent accidental legacy-ID reinterpretation',
                               'Both numeric payloads occupy eight bytes, so the bytes alone do not identify old versus new formats',
                               'Changing a model changes numeric IDs even for names whose spelling remains readable',
                               'Compile-time collision checks must include every declared method and all compatibility aliases',
                               'Existing numeric dispatch remains u64 comparisons; codec retraining alone does not prove a faster dispatch path'],
        'inventory': inventory,
    }
    destination = HERE / 'adoption-cpp-audit.json'
    destination.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['measured'], indent=2))


if __name__ == '__main__':
    main()
