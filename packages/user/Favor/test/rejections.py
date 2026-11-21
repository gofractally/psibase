"""Strict transaction-rejection assertions shared by the live smoke checks."""


def assert_rejected(trace, expected, service, method):
    if not isinstance(trace, dict) or not isinstance(trace.get('error'), str):
        raise AssertionError('Expected a structured failing transaction trace')
    if expected not in trace['error']:
        raise AssertionError(f"Expected {expected!r}; received {trace['error']!r}")

    def failed_action(value):
        if isinstance(value, list):
            return any(failed_action(item) for item in value)
        if not isinstance(value, dict):
            return False
        action = value.get('action', {})
        # MethodNumber's canonical display drops underscores and lowercases.
        actual_method = action.get('method', '').replace('_', '').lower()
        if (action.get('service') == service and actual_method == method.replace('_', '').lower()
                and expected in (value.get('error') or '')):
            return True
        return any(failed_action(item) for item in value.values())

    if not failed_action(trace.get('actionTraces', [])):
        raise AssertionError(f'Expected {service}::{method} to reject with {expected!r}')
