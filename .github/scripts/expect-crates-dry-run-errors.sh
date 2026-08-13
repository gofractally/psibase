#!/usr/bin/env bash

PREPARE_ERROR='error: failed to prepare local package for uploading'
SELECT_VERSION='failed to select a version for the requirement'
CRATES_IO_INDEX='location searched: crates.io index'

fail() {
    echo "$1" >&2
    exit 1
}

valid_prepare_cause() {
    local block="$1"
    [[ "$block" == *"$SELECT_VERSION"* && "$block" == *"$CRATES_IO_INDEX"* ]]
}

section_starts_new_event() {
    local line="$1"
    [[ "$line" == error:* ]] \
        || [[ "$line" == Publishing\ * ]] \
        || [[ "$line" == Building\ * ]]
}

finish_prepare() {
    local -n cause_ref=$1
    local cause="$cause_ref"

    if [[ -z "$cause" ]]; then
        fail "missing Caused by: block after prepare error"
    fi
    if ! valid_prepare_cause "$cause"; then
        fail "prepare error has unexpected cause"
    fi
    cause_ref=""
}

pending_prepare=0
expect_caused=0
cause=""

while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$PREPARE_ERROR" ]]; then
        if (( pending_prepare )); then
            finish_prepare cause
        fi
        pending_prepare=1
        expect_caused=0
        cause=""
        continue
    fi

    if (( pending_prepare )); then
        if [[ "$line" == "Caused by:" ]]; then
            expect_caused=1
            continue
        fi

        if (( expect_caused )); then
            if section_starts_new_event "$line"; then
                finish_prepare cause
                pending_prepare=0
                expect_caused=0
                if [[ "$line" == error:* && "$line" != "$PREPARE_ERROR" ]]; then
                    fail "unexpected error: $line"
                fi
                if [[ "$line" == error:* ]]; then
                    pending_prepare=1
                fi
                continue
            fi
            cause+="${line}"$'\n'
            continue
        fi

        if [[ -n "$line" ]]; then
            fail "expected Caused by: after prepare error, got: $line"
        fi
        continue
    fi

    if [[ "$line" == error:* ]]; then
        fail "unexpected error: $line"
    fi
done

if (( pending_prepare )); then
    finish_prepare cause
fi

exit 0
