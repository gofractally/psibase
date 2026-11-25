# Canonical dependency acquisition, following psiserve 28330232d7d1.
# Including this file does not fetch or add any targets; a consumer calls
# psibase_acquire_dependency(<name>). libraries/CMakeLists.txt acquires psio.
# The application must declare dependencies before adding dependency consumers.
include_guard(GLOBAL)
include(FetchContent)

function(psibase_declare_dependencies)
    if(CMAKE_VERSION VERSION_LESS 3.20)
        message(FATAL_ERROR "Canonical PSIO requires CMake 3.20 or newer")
    endif()
    # Do not use CMAKE_SOURCE_DIR: psibase's standalone storage and consumer
    # projects have different top-level source directories.
    get_filename_component(psibase_root "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/.." ABSOLUTE)

    # FetchContent's first declaration wins, including a containing project's
    # declarations. Local development uses FETCHCONTENT_SOURCE_DIR_<NAME>.
    # Exact commits, rather than moving branches, are the release/CI defaults.
    # Every declaration is source-only (SOURCE_SUBDIR names a directory that
    # does not exist, so FetchContent populates without adding the project).
    # psibase_acquire_dependency(psio) adds PSIO's project itself; see there.
    FetchContent_Declare(psio
        GIT_REPOSITORY https://github.com/gofractally/psio.git
        GIT_TAG e11fd099f5a584d259357dad0764502c91b992db
        GIT_SHALLOW FALSE
        SOURCE_DIR "${psibase_root}/external/psio"
        SOURCE_SUBDIR .psibase-no-top-level-cmake)
    FetchContent_Declare(psitri
        GIT_REPOSITORY https://github.com/gofractally/psitri.git
        GIT_TAG d3bba0e6a5f59e37c3eea08a1a720ae553cafb2c
        GIT_SHALLOW FALSE
        SOURCE_DIR "${psibase_root}/external/psitri"
        SOURCE_SUBDIR .psibase-no-top-level-cmake)
    FetchContent_Declare(ucc
        GIT_REPOSITORY https://github.com/gofractally/ucc.git
        GIT_TAG d79166da0290fdf9d1f9d5880d4dfb45b2822cf3
        GIT_SHALLOW FALSE
        SOURCE_DIR "${psibase_root}/external/ucc"
        SOURCE_SUBDIR .psibase-no-top-level-cmake)
    FetchContent_Declare(psizam
        GIT_REPOSITORY https://github.com/gofractally/psizam.git
        GIT_TAG 838e1ee89e6be491c1d0cb511dac4008eb38e28b
        GIT_SHALLOW FALSE
        # The native adapter does not build the optional spec testsuite.
        GIT_SUBMODULES ""
        SOURCE_DIR "${psibase_root}/external/psizam"
        SOURCE_SUBDIR .psibase-no-top-level-cmake)
endfunction()

# Sets <result> to TRUE when the directory that defines the psio target, or a
# directory above it, was added with EXCLUDE_FROM_ALL: its install rules are
# then not part of the top-level install.
function(psibase_psio_install_excluded result)
    set(${result} FALSE PARENT_SCOPE)
    if(NOT TARGET psio)
        return()
    endif()
    get_target_property(real psio ALIASED_TARGET)
    if(NOT real)
        set(real psio)
    endif()
    get_target_property(dir ${real} SOURCE_DIR)
    while(dir)
        get_property(excluded DIRECTORY "${dir}" PROPERTY EXCLUDE_FROM_ALL)
        if(excluded)
            set(${result} TRUE PARENT_SCOPE)
            return()
        endif()
        get_property(dir DIRECTORY "${dir}" PROPERTY PARENT_DIRECTORY)
    endwhile()
endfunction()

# Runs Git in <dir> without optional locks and without prompting. Sets
# <result>, <output> and <output>_error in the caller.
function(_psibase_git dir result output)
    execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0
        "${GIT_EXECUTABLE}" -C "${dir}" ${ARGN}
        RESULT_VARIABLE git_result OUTPUT_VARIABLE git_output ERROR_VARIABLE git_error
        OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_STRIP_TRAILING_WHITESPACE)
    set(${result} "${git_result}" PARENT_SCOPE)
    set(${output} "${git_output}" PARENT_SCOPE)
    set(${output}_error "${git_error}" PARENT_SCOPE)
endfunction()

# Indents Git output for a message, bounded so a large tree stays readable.
function(_psibase_quote_output text result)
    string(LENGTH "${text}" length)
    if(length GREATER 1500)
        string(SUBSTRING "${text}" 0 1500 text)
        string(APPEND text "\n...")
    endif()
    string(REPLACE "\n" "\n    " text "${text}")
    set(${result} "    ${text}" PARENT_SCOPE)
endfunction()

# An existing clean checkout whose HEAD is not the declared commit (the pin
# moved since it was fetched). Advance it when no developer work can be lost;
# otherwise stop with the reason found and the commands that resolve it.
#
# It is advanced only if all of these hold. The caller has already verified
# that it is a Git checkout root with an empty status (untracked files and
# submodules included) and no index flags that hide edits.
#  - HEAD is detached. FetchContent leaves its clones detached, so a checkout
#    on a local branch was put there by a person; moving them off their branch
#    silently would send their next commit to a detached HEAD.
#  - The current HEAD commit stays reachable: some ref (branch, tag,
#    remote-tracking) contains it, or it is an ancestor of the declared
#    commit. A commit made on the detached HEAD would otherwise be left to
#    the reflog and eventually pruned.
#  - The declared commit is present, or can be fetched from the declared
#    repository. Disconnected FetchContent modes do not fetch.
# The only mutations are `git fetch` (objects, and FETCH_HEAD before Git 2.29;
# no ref is created, moved or deleted) and `git checkout --detach`, which refuses to
# overwrite modified, untracked and (--no-overwrite-ignore) ignored files.
# Never reset, clean, or delete. Runs under the caller's acquisition lock.
function(_psibase_advance_existing name upper_name source repository revision head)
    set(manual
        "  git -C \"${source}\" fetch \"${repository}\" ${revision}\n"
        "  git -C \"${source}\" checkout --detach ${revision}\n")
    string(CONCAT manual ${manual})
    set(override
        "Or configure with -DFETCHCONTENT_SOURCE_DIR_${upper_name}=\"${source}\" to build this checkout "
        "as it is (an explicit development override: the declared commit is then not what is built).")
    string(CONCAT override ${override})
    set(preserving "Preserving existing ${name} source at ${source}")
    set(differs "HEAD is ${head}, the declared commit is ${revision}")

    _psibase_git("${source}" branch_result branch symbolic-ref -q HEAD)
    if(branch_result EQUAL 0)
        string(REGEX REPLACE "^refs/heads/" "" branch "${branch}")
        message(FATAL_ERROR
            "${preserving}: ${differs}, and the checkout is on the local branch '${branch}'. "
            "A checkout on a branch is not moved automatically. Nothing was changed. "
            "The branch keeps its commits; to build the declared commit run:\n${manual}${override}")
    elseif(NOT branch_result EQUAL 1)
        message(FATAL_ERROR
            "${preserving}: cannot tell whether HEAD is detached (git symbolic-ref failed: ${branch_error}). "
            "Nothing was changed. ${override}")
    endif()

    _psibase_git("${source}" present_result ignored cat-file -e "${revision}^{commit}")
    set(fetched FALSE)
    if(NOT present_result EQUAL 0)
        if(FETCHCONTENT_FULLY_DISCONNECTED OR FETCHCONTENT_UPDATES_DISCONNECTED OR
           FETCHCONTENT_UPDATES_DISCONNECTED_${upper_name})
            message(FATAL_ERROR
                "${preserving}: ${differs}. The declared commit is not in this checkout and FetchContent is "
                "disconnected (FETCHCONTENT_FULLY_DISCONNECTED or FETCHCONTENT_UPDATES_DISCONNECTED), "
                "so it was not fetched. Nothing was changed. Configure connected once, or run:\n"
                "${manual}${override}")
        endif()
        if(NOT repository)
            message(FATAL_ERROR
                "${preserving}: ${differs}. The declared commit is not in this checkout and the winning "
                "declaration has no GIT_REPOSITORY to fetch it from. Nothing was changed. ${override}")
        endif()
        message(STATUS "psibase: fetching ${name} ${revision} from ${repository}")
        # Objects only where Git can (2.29): a fetch, also a failed one,
        # otherwise rewrites the developer's FETCH_HEAD.
        set(fetch_options --no-tags --no-recurse-submodules)
        if(NOT GIT_VERSION_STRING VERSION_LESS 2.29)
            list(APPEND fetch_options --no-write-fetch-head)
        endif()
        _psibase_git("${source}" fetch_result fetch_output
            fetch ${fetch_options} "${repository}" "${revision}")
        set(fetch_error "${fetch_output_error}")
        _psibase_git("${source}" present_result ignored cat-file -e "${revision}^{commit}")
        if(NOT present_result EQUAL 0)
            # Some servers refuse a commit that is not a ref tip. Fetch the
            # advertised branches and tags by name instead; without a
            # destination no ref is created.
            _psibase_git("${source}" list_result remote_refs ls-remote --heads --tags "${repository}")
            if(list_result EQUAL 0 AND remote_refs)
                string(REGEX MATCHALL "refs/[^\n^]+(\n|$)" ref_names "${remote_refs}")
                string(REPLACE "\n" "" ref_names "${ref_names}")
                _psibase_git("${source}" fetch_result fetch_output
                    fetch ${fetch_options} "${repository}" ${ref_names})
                string(APPEND fetch_error "\n${fetch_output_error}")
                _psibase_git("${source}" present_result ignored cat-file -e "${revision}^{commit}")
            endif()
        endif()
        if(NOT present_result EQUAL 0)
            _psibase_quote_output("${fetch_error}" fetch_error)
            message(FATAL_ERROR
                "${preserving}: ${differs}, and the declared commit could not be fetched from ${repository} "
                "(offline, wrong URL, or the commit is not published there). The working tree, HEAD and "
                "refs were not changed. Git reported:\n${fetch_error}\n"
                "When the repository is reachable, configure again, or run:\n${manual}${override}")
        endif()
        set(fetched TRUE)
    endif()

    _psibase_git("${source}" refs_result containing_refs for-each-ref --count=1 --contains "${head}")
    if(NOT refs_result EQUAL 0)
        message(FATAL_ERROR
            "${preserving}: ${differs}; cannot list the refs that contain HEAD "
            "(${containing_refs_error}). The working tree, HEAD and refs were not changed. ${override}")
    endif()
    if(NOT containing_refs)
        _psibase_git("${source}" ancestor_result ignored merge-base --is-ancestor "${head}" "${revision}")
        if(NOT ancestor_result EQUAL 0)
            string(SUBSTRING "${head}" 0 12 short_head)
            message(FATAL_ERROR
                "${preserving}: ${differs}. HEAD is detached at a commit that no branch, tag or "
                "remote-tracking ref contains and that is not an ancestor of the declared commit; "
                "moving away would leave it reachable only through the reflog. "
                "The working tree, HEAD and refs were not changed. To keep the commit, name it and "
                "configure again (the checkout is then advanced automatically):\n"
                "  git -C \"${source}\" branch keep-${short_head} ${head}\n"
                "To move without keeping a name for it:\n${manual}${override}")
        endif()
    endif()

    _psibase_git("${source}" checkout_result checkout_output
        checkout --quiet --no-overwrite-ignore --detach "${revision}")
    if(NOT checkout_result EQUAL 0)
        _psibase_quote_output("${checkout_output_error}" checkout_error)
        message(FATAL_ERROR
            "${preserving}: ${differs}, and git checkout --detach refused to move there "
            "(for example an ignored file would be overwritten). Nothing was reset or removed. "
            "Git reported:\n${checkout_error}\n"
            "Move the named files away and configure again. ${override}")
    endif()
    _psibase_git("${source}" head_result new_head rev-parse HEAD)
    _psibase_git("${source}" status_result new_status
        status --porcelain --untracked-files=all --ignore-submodules=none)
    _psibase_git("${source}" flags_result new_flags ls-files -v)
    if(NOT head_result EQUAL 0 OR NOT new_head STREQUAL revision)
        message(FATAL_ERROR
            "${preserving}: git checkout --detach ${revision} succeeded but HEAD is '${new_head}'. "
            "Nothing was reset. Inspect the checkout. ${override}")
    endif()
    if(NOT status_result EQUAL 0 OR NOT flags_result EQUAL 0 OR new_status OR
       new_flags MATCHES "(^|\n)[a-zS] ")
        _psibase_quote_output("${new_status}" new_status)
        message(FATAL_ERROR
            "${preserving}: HEAD was advanced from ${head} to ${revision}, but the source is not clean "
            "afterwards (an initialized submodule that the new commit moves, for example). "
            "Nothing was reset. git status reports:\n${new_status}\n"
            "Bring it to the declared state (for a submodule: "
            "git -C \"${source}\" submodule update --recursive) and configure again. ${override}")
    endif()
    if(fetched)
        set(how "fetched from ${repository}")
    else()
        set(how "commit already present, no fetch")
    endif()
    message(STATUS "psibase: advanced ${name} from ${head} to ${revision} "
        "(${how}; git checkout --detach, previous commit still reachable)")
endfunction()

function(psibase_acquire_dependency name)
    set(supported psio psitri ucc psizam)
    if(NOT name IN_LIST supported)
        message(FATAL_ERROR "Unknown psibase dependency: ${name}")
    endif()
    psibase_declare_dependencies()
    FetchContent_GetProperties(${name})
    if(name STREQUAL "psio")
        # Old and new PSIO both define `psio` and the psio/ include namespace.
        if((TARGET psio OR TARGET psio::psio) AND NOT psio_POPULATED)
            message(FATAL_ERROR
                "A PSIO target already exists outside this FetchContent dependency. "
                "Retire the legacy PSIO target before activating canonical PSIO; "
                "installed-package consumers should use find_package directly.")
        endif()
    endif()
    string(TOUPPER "${name}" upper_name)
    set(explicit_override "${FETCHCONTENT_SOURCE_DIR_${upper_name}}")

    # FetchContent has no public accessor for the winning declaration before
    # population. Read its saved declaration, and fail closed if CMake changes
    # this representation. Guessing SOURCE_DIR would defeat first-declare-wins
    # and could let a new build tree delete a different existing checkout.
    get_property(has_details GLOBAL PROPERTY "_FetchContent_${name}_savedDetails" SET)
    if(NOT has_details)
        message(FATAL_ERROR "Cannot safely inspect the winning ${name} FetchContent declaration")
    endif()
    get_property(saved_details GLOBAL PROPERTY "_FetchContent_${name}_savedDetails")
    cmake_parse_arguments(declared "" "SOURCE_DIR;GIT_REPOSITORY;GIT_TAG" "" ${saved_details})
    if(NOT declared_SOURCE_DIR)
        message(FATAL_ERROR "Cannot safely determine the winning ${name} source directory")
    endif()

    set(acquisition fetched)
    if(${name}_POPULATED)
        set(acquisition already-populated)
    elseif(explicit_override)
        set(acquisition explicit-override)
    else()
        # A first population in *each build tree* may remove SOURCE_DIR before
        # cloning. Serialize participating build trees, then never give that
        # clone operation a pre-existing source directory.
        get_filename_component(lock_source "${declared_SOURCE_DIR}" REALPATH)
        get_filename_component(lock_parent "${lock_source}" DIRECTORY)
        file(MAKE_DIRECTORY "${lock_parent}")
        file(LOCK "${lock_source}.psibase-fetch.lock" GUARD FUNCTION
            TIMEOUT 180 RESULT_VARIABLE lock_result)
        if(NOT lock_result STREQUAL "0")
            message(FATAL_ERROR "Cannot lock ${name} source acquisition: ${lock_result}")
        endif()
        if(EXISTS "${declared_SOURCE_DIR}" OR IS_SYMLINK "${declared_SOURCE_DIR}")
            # Another participating build may have created it while this one
            # waited. Resolve again now (notably /var -> /private/var on macOS).
            get_filename_component(existing_source "${declared_SOURCE_DIR}" REALPATH)
            find_package(Git REQUIRED)
            _psibase_git("${declared_SOURCE_DIR}" git_result git_root rev-parse --show-toplevel)
            get_filename_component(git_root "${git_root}" REALPATH)
            set(override_hint
                "Or configure with -DFETCHCONTENT_SOURCE_DIR_${upper_name}=\"${declared_SOURCE_DIR}\" to build "
                "this source as it is (an explicit development override: the declared commit is then "
                "not what is built).")
            string(CONCAT override_hint ${override_hint})
            if(NOT git_result EQUAL 0 OR NOT git_root STREQUAL existing_source)
                if(git_result EQUAL 0)
                    set(what "it is inside the Git checkout ${git_root}, not a checkout root of its own")
                else()
                    set(what "it is not a Git checkout")
                endif()
                message(FATAL_ERROR
                    "Preserving existing ${name} source at ${declared_SOURCE_DIR}: it is not a Git checkout root "
                    "(${what}), so it cannot be verified against the declared commit ${declared_GIT_TAG}. "
                    "Nothing was changed or removed. To let the configure step clone the declared commit, "
                    "move the directory away and configure again:\n"
                    "  mv \"${declared_SOURCE_DIR}\" \"${declared_SOURCE_DIR}.saved\"\n"
                    "${override_hint}")
            endif()
            string(LENGTH "${declared_GIT_TAG}" revision_length)
            if(NOT (revision_length EQUAL 40 OR revision_length EQUAL 64) OR
               NOT declared_GIT_TAG MATCHES "^[0-9a-fA-F]+$")
                message(FATAL_ERROR
                    "Preserving existing ${name} source at ${declared_SOURCE_DIR}: the winning declaration's "
                    "GIT_TAG '${declared_GIT_TAG}' is not an exact Git commit, and safe automatic reuse "
                    "requires one. Nothing was changed. Declare a full commit hash. ${override_hint}")
            endif()
            _psibase_git("${declared_SOURCE_DIR}" head_result existing_head rev-parse --verify HEAD)
            _psibase_git("${declared_SOURCE_DIR}" status_result existing_status
                status --porcelain --untracked-files=all --ignore-submodules=none)
            _psibase_git("${declared_SOURCE_DIR}" flags_result index_flags ls-files -v)
            if(NOT head_result EQUAL 0 OR NOT status_result EQUAL 0 OR NOT flags_result EQUAL 0)
                message(FATAL_ERROR
                    "Preserving existing ${name} source at ${declared_SOURCE_DIR}: Git could not inspect it "
                    "(rev-parse HEAD: ${head_result} ${existing_head_error}; status: ${status_result} "
                    "${existing_status_error}; ls-files: ${flags_result} ${index_flags_error}). "
                    "Nothing was changed. Repair the checkout, or move it away so that the configure step "
                    "clones the declared commit:\n"
                    "  mv \"${declared_SOURCE_DIR}\" \"${declared_SOURCE_DIR}.saved\"\n"
                    "${override_hint}")
            endif()
            if(existing_head STREQUAL declared_GIT_TAG)
                set(head_note "HEAD is the declared commit ${declared_GIT_TAG}")
                set(then_note "Then configure again.")
            else()
                set(head_note "HEAD is ${existing_head}, the declared commit is ${declared_GIT_TAG}")
                set(then_note
                    "Then configure again; a clean checkout on a detached HEAD is advanced to the declared commit automatically.")
            endif()
            if(existing_status)
                _psibase_quote_output("${existing_status}" quoted_status)
                message(FATAL_ERROR
                    "Preserving existing ${name} source at ${declared_SOURCE_DIR}: the source has uncommitted "
                    "changes or untracked files (${head_note}). Nothing was reset, cleaned or cloned. "
                    "git status --porcelain reports:\n${quoted_status}\n"
                    "Commit them on a branch, or set them aside (kept in the stash, restored with "
                    "'git stash pop'):\n"
                    "  git -C \"${declared_SOURCE_DIR}\" stash push --include-untracked\n"
                    "${then_note}\n${override_hint}")
            endif()
            if(index_flags MATCHES "(^|\n)[a-zS] ")
                string(REGEX MATCHALL "(^|\n)[a-zS] [^\n]*" flagged "${index_flags}")
                string(REPLACE ";" "" flagged "${flagged}")
                string(STRIP "${flagged}" flagged)
                _psibase_quote_output("${flagged}" flagged)
                message(FATAL_ERROR
                    "Preserving existing ${name} source at ${declared_SOURCE_DIR}: index flags "
                    "(assume-unchanged or skip-worktree) can hide edits from git status, so the source "
                    "cannot be verified clean (${head_note}). Nothing was changed. "
                    "git ls-files -v marks (lowercase: assume-unchanged, S: skip-worktree):\n${flagged}\n"
                    "Clear the flag of each listed file, then check git status:\n"
                    "  git -C \"${declared_SOURCE_DIR}\" update-index --no-assume-unchanged -- <file>\n"
                    "  git -C \"${declared_SOURCE_DIR}\" update-index --no-skip-worktree -- <file>\n"
                    "${then_note}\n${override_hint}")
            endif()
            set(acquisition verified-existing)
            if(NOT existing_head STREQUAL declared_GIT_TAG)
                # Returns only after HEAD is the declared commit and clean.
                _psibase_advance_existing(${name} ${upper_name} "${declared_SOURCE_DIR}"
                    "${declared_GIT_REPOSITORY}" "${declared_GIT_TAG}" "${existing_head}")
                set(existing_head "${declared_GIT_TAG}")
                set(acquisition advanced-existing)
            endif()
            # Function-local only: this is verified reuse of the graph's exact
            # source/pin, not a hidden HOME override or a persistent dev setting.
            # Skipping clone/update also preserves clean unpushed refs and tags.
            # Establish the empty public cache entry first: MakeAvailable would
            # otherwise seed it from the temporary normal variable below.
            set(FETCHCONTENT_SOURCE_DIR_${upper_name} "" CACHE PATH
                "Explicit developer source override for ${name}")
            set(FETCHCONTENT_SOURCE_DIR_${upper_name} "${declared_SOURCE_DIR}")
            message(STATUS "psibase: reusing ${name} at ${existing_head} without Git clone/update")
        endif()
    endif()
    # FetchContent only populates sources here. The psitri/ucc/psizam adapters
    # explicitly add the validated, codec-free engine subset; never evaluate
    # those upstream roots.
    FetchContent_MakeAvailable(${name})
    FetchContent_GetProperties(${name})
    if(name STREQUAL "psio")
        # PSIO's maintained project is added here rather than by FetchContent,
        # so that the consumer chooses its scope on every supported CMake
        # (FetchContent_Declare(... EXCLUDE_FROM_ALL) needs CMake 3.28).
        # A consumer that only links PSIO (the psibase build) sets
        # PSIBASE_PSIO_EXCLUDE_FROM_ALL: the directory's install rules (PSIO's
        # native archive, headers and package config, and those of the
        # simdjson it fetches in a subdirectory) then stay out of the
        # consumer's install tree and packages, and its targets are built
        # only as dependencies of the consumer's targets.
        # A containing project's earlier declaration without SOURCE_SUBDIR has
        # already added the project in FetchContent_MakeAvailable.
        if(NOT TARGET psio::psio)
            if(NOT EXISTS "${psio_SOURCE_DIR}/CMakeLists.txt")
                message(FATAL_ERROR "The selected PSIO source has no CMake project: ${psio_SOURCE_DIR}")
            endif()
            if(PSIBASE_PSIO_EXCLUDE_FROM_ALL)
                add_subdirectory("${psio_SOURCE_DIR}" "${psio_BINARY_DIR}" EXCLUDE_FROM_ALL)
            else()
                add_subdirectory("${psio_SOURCE_DIR}" "${psio_BINARY_DIR}")
            endif()
        endif()
        if(NOT TARGET psio::psio)
            message(FATAL_ERROR "The selected PSIO source did not provide psio::psio")
        endif()
        if(PSIBASE_PSIO_EXCLUDE_FROM_ALL)
            # Also covers PSIO added earlier: by another declaration, or by an
            # acquisition that did not ask for exclusion.
            psibase_psio_install_excluded(psio_excluded)
            if(NOT psio_excluded)
                message(FATAL_ERROR
                    "PSIBASE_PSIO_EXCLUDE_FROM_ALL is set, but PSIO was already added "
                    "without EXCLUDE_FROM_ALL; its install rules would be added to the consumer's")
            endif()
        endif()
    endif()
    find_package(Git REQUIRED)
    execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
        "${GIT_EXECUTABLE}" -C "${${name}_SOURCE_DIR}" rev-parse HEAD
        RESULT_VARIABLE provenance_git_result OUTPUT_VARIABLE source_head
        OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
    if(NOT provenance_git_result EQUAL 0)
        set(source_head "not-a-git-checkout")
    endif()
    execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
        "${GIT_EXECUTABLE}" -C "${${name}_SOURCE_DIR}" status --porcelain --untracked-files=all --ignore-submodules=none
        RESULT_VARIABLE provenance_status_result OUTPUT_VARIABLE source_status
        OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
    if(NOT provenance_status_result EQUAL 0)
        set(source_status "unavailable")
    endif()
    file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/psibase-dependencies")
    file(WRITE "${CMAKE_BINARY_DIR}/psibase-dependencies/${name}-source.txt"
        "name=${name}\nmode=${acquisition}\nsource=${${name}_SOURCE_DIR}\nhead=${source_head}\n"
        "declared_repository=${declared_GIT_REPOSITORY}\ndeclared_revision=${declared_GIT_TAG}\n"
        "explicit_source_override=${explicit_override}\ngit_status=${source_status}\n")
    set(${name}_SOURCE_DIR "${${name}_SOURCE_DIR}" PARENT_SCOPE)
    set(${name}_BINARY_DIR "${${name}_BINARY_DIR}" PARENT_SCOPE)
endfunction()
