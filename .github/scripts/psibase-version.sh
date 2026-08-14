#!/usr/bin/env bash

VERSION_HPP="libraries/psibase/common/include/psibase/version.hpp"

read_version_at() {
    local ref="$1"
    local content major minor patch

    content=$(git show "${ref}:${VERSION_HPP}" 2>/dev/null) || return 1

    major=$(grep -E '^#define PSIBASE_VERSION_MAJOR' <<<"$content" | awk '{print $3}')
    minor=$(grep -E '^#define PSIBASE_VERSION_MINOR' <<<"$content" | awk '{print $3}')
    patch=$(grep -E '^#define PSIBASE_VERSION_PATCH' <<<"$content" | awk '{print $3}')

    if [[ -z "$major" || -z "$minor" || -z "$patch" ]]; then
        return 1
    fi

    echo "${major}.${minor}.${patch}"
}

cmd_at() {
    if [[ $# -ne 1 ]]; then
        echo "usage: $0 at <git-ref>" >&2
        exit 2
    fi
    read_version_at "$1"
}

cmd_changed() {
    local ver_a ver_b

    if [[ $# -ne 2 ]]; then
        echo "usage: $0 changed <git-ref-a> <git-ref-b>" >&2
        exit 2
    fi

    ver_a=$(read_version_at "$1") || exit 2
    ver_b=$(read_version_at "$2") || exit 2

    if [[ "$ver_a" == "$ver_b" ]]; then
        exit 1
    fi
    exit 0
}

cmd_tag_name() {
    local ver="$1"
    local major="${ver%%.*}"

    if [[ $# -ne 1 || -z "$ver" || "$ver" != *.*.* ]]; then
        echo "usage: $0 tag-name <major.minor.patch>" >&2
        exit 2
    fi

    if [[ "$major" == "0" ]]; then
        echo "v${ver}-pre"
    else
        echo "v${ver}"
    fi
}

cmd_release_branch() {
    local ver="$1"
    local major="${ver%%.*}"

    if [[ $# -ne 1 || -z "$ver" || "$ver" != *.*.* ]]; then
        echo "usage: $0 release-branch <major.minor.patch>" >&2
        exit 2
    fi

    echo "release/v${major}"
}

main() {
    local cmd="${1:-}"

    case "$cmd" in
        at) shift; cmd_at "$@" ;;
        changed) shift; cmd_changed "$@" ;;
        tag-name) shift; cmd_tag_name "$@" ;;
        release-branch) shift; cmd_release_branch "$@" ;;
        *)
            echo "usage: $0 at|changed|tag-name|release-branch ..." >&2
            exit 2
            ;;
    esac
}

main "$@"
