#!/usr/bin/env python3
"""Contract tests for bounded development-only action-name weight updates."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import action_name_training as trainer


def metrics(core=('getBalance',), preferred=('registerEventIndex',),
            external=None, macro=90.0, ecosystems=None):
    names = [f'external{i}' for i in range(1000)]
    return {
        'groups': {
            'core': {'names': ['getBalance', 'cancelOrder'], 'fit_names': list(core)},
            'preferred': {'names': ['registerEventIndex', 'setPublicKey'],
                          'fit_names': list(preferred)},
            'external': {'names': names,
                         'fit_names': names[:900] if external is None else list(external)},
        },
        'external_macro': {
            'balanced_macro_percent': macro,
            'ecosystem_macro_percent': {'cpp': 90.0, 'rust': 90.0}
            if ecosystems is None else ecosystems,
        },
    }


class WeightPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Realistic order of magnitude makes one average vote small, rather
        # than immediately exhausting the cumulative budget in toy corpora.
        cls.base = {f'externalMethod{i}': 1 / 30000 for i in range(30000)}

    def setUp(self):
        self.policy = copy.deepcopy(trainer.DEFAULT_POLICY)

    def validate(self, previous, requested):
        return trainer.validate_weights(self.base, previous, requested, self.policy)

    def test_ordinary_addition_and_twofold_steps_are_allowed(self):
        self.assertIsInstance(self.validate({}, {'newMethod': 1}), dict)
        self.assertIsInstance(self.validate({'newMethod': 1}, {'newMethod': 2}), dict)
        self.assertIsInstance(self.validate({'newMethod': 5}, {'newMethod': 10}), dict)

    def test_new_name_cannot_start_overweighted(self):
        with self.assertRaises(ValueError):
            self.validate({}, {'newMethod': 1.01})

    def test_step_cap_is_relative_to_previous_accepted_weight(self):
        with self.assertRaises(ValueError):
            self.validate({'newMethod': 1}, {'newMethod': 2.01})
        with self.assertRaises(ValueError):
            self.validate({'newMethod': .1}, {'newMethod': .21})

    def test_absolute_cap_holds_after_many_valid_steps(self):
        self.assertIsInstance(self.validate({'newMethod': 8}, {'newMethod': 10}), dict)
        with self.assertRaises(ValueError):
            self.validate({'newMethod': 8}, {'newMethod': 10.01})

    def test_budget_is_cumulative_across_all_names(self):
        previous = {f'newMethod{i}': 5 for i in range(10)}
        self.assertIsInstance(self.validate(previous, previous), dict)
        # Every individual step respects the 2x and 10x caps, but their sum
        # exceeds the 0.25% total model-mass budget.
        requested = {name: 10 for name in previous}
        with self.assertRaises(ValueError):
            self.validate(previous, requested)

    def test_number_of_target_names_is_bounded_independently(self):
        with self.assertRaises(ValueError):
            self.validate({}, {f'newMethod{i}': 1 for i in range(33)})

    def test_decreases_and_omissions_are_allowed_for_later_metric_review(self):
        self.assertIsInstance(self.validate({'newMethod': 4}, {'newMethod': 1}), dict)
        self.assertIsInstance(self.validate({'newMethod': 4}, {}), dict)

    def test_additive_vote_for_an_existing_external_name_is_allowed(self):
        self.assertIsInstance(self.validate({}, {'externalMethod0': 1}), dict)

    def test_nonfinite_nonpositive_and_non_numeric_weights_rejected(self):
        for value in (0, -1, float('nan'), float('inf'), -float('inf'), '1', None, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate({}, {'newMethod': value})

    def test_bad_names_and_casefold_duplicates_rejected(self):
        for name in ('', 'has space', 'new-Method', 'méthod', '#hash'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.validate({}, {name: 1})
        with self.assertRaises(ValueError):
            self.validate({}, {'newMethod': 1, 'newmethod': 1})

    def test_validation_never_mutates_training_inputs(self):
        base = {'alpha': .5, 'beta': .5}
        previous = {'newMethod': .001}
        requested = {'newMethod': .002}
        snapshot = copy.deepcopy((base, previous, requested, self.policy))
        trainer.validate_weights(base, previous, requested, self.policy)
        self.assertEqual((base, previous, requested, self.policy), snapshot)


class MetricGatesTests(unittest.TestCase):
    def setUp(self):
        self.policy = copy.deepcopy(trainer.DEFAULT_POLICY)
        self.baseline = metrics()

    def errors(self, previous, current):
        return trainer.check_metrics(self.baseline, previous, current, self.policy)

    def test_unchanged_and_improved_fit_sets_pass(self):
        self.assertEqual(self.errors(self.baseline, copy.deepcopy(self.baseline)), [])
        improved = metrics(core=('getBalance', 'cancelOrder'),
                           preferred=('registerEventIndex', 'setPublicKey'), macro=90.1)
        self.assertEqual(self.errors(self.baseline, improved), [])

    def test_baseline_core_and_preferred_readable_names_cannot_be_lost(self):
        for group in ('core', 'preferred'):
            current = copy.deepcopy(self.baseline)
            current['groups'][group]['fit_names'] = []
            with self.subTest(group=group):
                self.assertTrue(self.errors(self.baseline, current))

    def test_newly_accepted_core_and_preferred_successes_are_also_protected(self):
        previous = metrics(core=('getBalance', 'cancelOrder'),
                           preferred=('registerEventIndex', 'setPublicKey'))
        for group in ('core', 'preferred'):
            current = copy.deepcopy(previous)
            current['groups'][group]['fit_names'].pop()
            with self.subTest(group=group):
                self.assertTrue(self.errors(previous, current))

    def test_macro_drift_is_measured_against_frozen_baseline(self):
        previous = metrics(macro=89.8)
        current = metrics(macro=89.6)
        self.assertTrue(self.errors(previous, current))
        self.assertEqual(self.errors(previous, metrics(macro=89.8)), [])

    def test_ecosystem_drift_is_measured_against_frozen_baseline(self):
        previous = metrics(ecosystems={'cpp': 89.4, 'rust': 90.6})
        current = metrics(ecosystems={'cpp': 88.9, 'rust': 91.1})
        self.assertTrue(self.errors(previous, current))

    def test_external_name_swaps_cannot_hide_excessive_baseline_losses(self):
        original = self.baseline['groups']['external']['fit_names']
        # Keep the pooled fit count constant and macro scores unchanged while
        # replacing six baseline successes with previously unreadable names.
        current = metrics(external=original[6:] + [f'external{i}' for i in range(900, 906)])
        self.assertEqual(len(current['groups']['external']['fit_names']), len(original))
        self.assertTrue(self.errors(self.baseline, current))

    def test_small_external_swaps_within_budget_are_allowed(self):
        original = self.baseline['groups']['external']['fit_names']
        current = metrics(external=original[4:] + [f'external{i}' for i in range(900, 904)])
        self.assertEqual(self.errors(self.baseline, current), [])


class ReleaseLockTests(unittest.TestCase):
    def test_presence_of_release_lock_blocks_development_even_if_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            pack = Path(directory)
            trainer.assert_development(pack)
            (pack / 'release.lock').write_text('')
            with self.assertRaises((ValueError, RuntimeError)):
                trainer.assert_development(pack)


class PackIntegrityTests(unittest.TestCase):
    def make_pack(self, path):
        pack = Path(path)
        (pack / 'inputs').mkdir()
        trainer.write(pack / 'inputs' / 'policy.json', {'saved_policy': True})
        document = {'format_version': 'synthetic-integrity-test'}
        measured = metrics()
        measured['values'] = {}
        revision = trainer.save_revision(pack, None, {}, document, measured,
                                         {'policy_errors': []}, 'Integrity fixture')
        trainer.point_current(pack, revision)
        trainer.write(pack / 'baseline.json', {'revision': revision})
        return pack, revision

    def test_revision_artifact_and_saved_input_tampering_are_detected(self):
        for target in ('model', 'input'):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                pack, revision = self.make_pack(directory)
                trainer.verify_revision(pack, revision)
                path = (pack / 'revisions' / revision / 'model.json' if target == 'model'
                        else pack / 'inputs' / 'policy.json')
                path.write_text('{}\n')
                with self.assertRaises(ValueError):
                    trainer.verify_revision(pack, revision)

    def test_revision_identifier_cannot_escape_revision_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                trainer.revision_path(Path(directory), '../somewhere')

    def test_verify_pack_checks_both_current_and_baseline_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            pack, revision = self.make_pack(directory)
            # This fixture isolates the saved-pack integrity contract. Codec
            # validation and full golden vectors belong to model/CLI checks.
            measured = metrics()
            measured['values'] = {}
            evaluation = {'groups': {'external': [], 'preferred': []}}
            with patch.object(trainer, 'load_model', return_value=object()), \
                    patch.object(trainer, 'inputs', return_value=({'alpha': 1}, evaluation, trainer.DEFAULT_POLICY)), \
                    patch.object(trainer, 'evaluate', return_value=measured):
                self.assertEqual(trainer.verify_pack(pack)[0], revision)
                trainer.write(pack / 'baseline.json', {'revision': '../not-a-revision'})
                with self.assertRaises(ValueError):
                    trainer.verify_pack(pack)

    def test_rejected_candidate_cannot_become_current_by_pointer_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            pack, baseline = self.make_pack(directory)
            measured = metrics()
            measured['values'] = {}
            rejected = trainer.save_revision(pack, baseline, {},
                                             {'format_version': 'synthetic-integrity-test'},
                                             measured, {'policy_errors': ['core readable regression']},
                                             'Rejected candidate fixture')
            trainer.point_current(pack, rejected)
            with self.assertRaises(ValueError):
                trainer.verify_pack(pack)


class FreezeEvidenceTests(unittest.TestCase):
    def make_evidence(self, directory, mutate=None):
        directory = Path(directory)
        pack = directory / 'pack'
        revision, model_hash = 'a' * 64, 'b' * 64
        revision_dir = pack / 'revisions' / revision
        revision_dir.mkdir(parents=True)
        trainer.write(revision_dir / 'golden.json', {'vectors': [{'text': 'fixture'}]})
        trainer.write(revision_dir / 'manifest.json', {'fixture': True})
        golden_hash = trainer.sha((revision_dir / 'golden.json').read_bytes())
        report_dir = directory / 'reports'
        report_dir.mkdir()
        evidence = {'revision': revision, 'model_sha256': model_hash,
                    'release_checklist_complete': True, 'languages': {}}
        for language in ('cpp', 'rust', 'javascript'):
            report = {'language': language, 'passed': True, 'model_sha256': model_hash,
                      'golden_sha256': golden_hash, 'vector_count': 1,
                      'checks': {name: True for name in ('malformed', 'boundaries',
                                                       'hash_fallback', 'round_trip', 'duplicate_ids')}}
            if mutate:
                mutate(language, report)
            path = report_dir / f'{language}.json'
            # Deliberately allow nonstandard numeric JSON in negative fixtures:
            # the production reader must reject it rather than trusting NaN.
            path.write_text(json.dumps(report, allow_nan=True))
            evidence['languages'][language] = {'passed': True,
                                               'report_sha256': trainer.sha(path.read_bytes()),
                                               'report_path': path.name}
        evidence_path = report_dir / 'conformance.json'
        trainer.write(evidence_path, evidence)
        return pack, revision, {'model_sha256': model_hash}, evidence_path

    def test_valid_language_bound_evidence_is_preserved_and_locks_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            pack, revision, manifest, evidence = self.make_evidence(directory)
            with patch.object(trainer, 'verify_pack', return_value=(revision, manifest)), \
                    patch('builtins.print'):
                trainer.freeze(pack, evidence)
            trainer.read(pack / 'release.lock')
            for language in ('cpp', 'rust', 'javascript'):
                self.assertEqual((pack / 'release-reports' / f'{language}.json').read_bytes(),
                                 (evidence.parent / f'{language}.json').read_bytes())
            with self.assertRaises(ValueError):
                trainer.assert_development(pack)

    def test_one_language_report_cannot_stand_in_for_another(self):
        with tempfile.TemporaryDirectory() as directory:
            def mutate(language, report):
                if language == 'cpp':
                    report['language'] = 'javascript'
            pack, revision, manifest, evidence = self.make_evidence(directory, mutate)
            with patch.object(trainer, 'verify_pack', return_value=(revision, manifest)), \
                    self.assertRaises(ValueError):
                trainer.freeze(pack, evidence)
            self.assertFalse((pack / 'release.lock').exists())

    def test_vector_count_must_be_a_strict_nonnegative_integer(self):
        for count in (float('nan'), float('inf'), 1.5, True, -1, 0):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as directory:
                def mutate(language, report):
                    if language == 'cpp':
                        report['vector_count'] = count
                pack, revision, manifest, evidence = self.make_evidence(directory, mutate)
                with patch.object(trainer, 'verify_pack', return_value=(revision, manifest)), \
                        self.assertRaises(ValueError):
                    trainer.freeze(pack, evidence)
                self.assertFalse((pack / 'release.lock').exists())

    def test_report_file_hash_is_checked_before_freezing(self):
        with tempfile.TemporaryDirectory() as directory:
            pack, revision, manifest, evidence = self.make_evidence(directory)
            (evidence.parent / 'cpp.json').write_text('{}\n')
            with patch.object(trainer, 'verify_pack', return_value=(revision, manifest)), \
                    self.assertRaises(ValueError):
                trainer.freeze(pack, evidence)
            self.assertFalse((pack / 'release.lock').exists())


if __name__ == '__main__':
    unittest.main()
