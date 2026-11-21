# Canonical dependency acquisition, following psiserve 28330232d7d1.
# Deliberately dormant: including this file does not fetch or add any targets.
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
    FetchContent_Declare(psio
        GIT_REPOSITORY https://github.com/gofractally/psio.git
        GIT_TAG f6b10ec7d7bba4022cd1c9394f88ad1440b4b2b7
        GIT_SHALLOW FALSE
        SOURCE_DIR "${psibase_root}/external/psio")
    FetchContent_Declare(psitri
        GIT_REPOSITORY git@github.com:gofractally/psitri.git
        GIT_TAG a7d92aabb6a7fa0d73ff4f689e16a5507c026d09
        GIT_SHALLOW FALSE
        SOURCE_DIR "${psibase_root}/external/psitri"
        SOURCE_SUBDIR .psibase-no-top-level-cmake)
    FetchContent_Declare(ucc
        GIT_REPOSITORY https://github.com/gofractally/ucc.git
        GIT_TAG cd2e2e305363588e8c9c8eb8b23572cd56952ce7
        GIT_SHALLOW FALSE
        SOURCE_DIR "${psibase_root}/external/ucc"
        SOURCE_SUBDIR .psibase-no-top-level-cmake)
    FetchContent_Declare(psizam
        GIT_REPOSITORY https://github.com/gofractally/psizam.git
        GIT_TAG 4da50574dfeecece12bfc75e0f204031835d9db8
        GIT_SHALLOW FALSE
        # The native adapter does not build the optional spec testsuite.
        GIT_SUBMODULES ""
        SOURCE_DIR "${psibase_root}/external/psizam"
        SOURCE_SUBDIR .psibase-no-top-level-cmake)
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
            execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
                "${GIT_EXECUTABLE}" -C "${declared_SOURCE_DIR}" rev-parse --show-toplevel
                RESULT_VARIABLE git_result OUTPUT_VARIABLE git_root OUTPUT_STRIP_TRAILING_WHITESPACE
                ERROR_QUIET)
            get_filename_component(git_root "${git_root}" REALPATH)
            if(NOT git_result EQUAL 0 OR NOT git_root STREQUAL existing_source)
                message(FATAL_ERROR
                    "Preserving existing ${name} source at ${declared_SOURCE_DIR}: it is not a Git checkout root. "
                    "Use an explicit FETCHCONTENT_SOURCE_DIR_${upper_name} for development, or select a new source path.")
            endif()
            string(LENGTH "${declared_GIT_TAG}" revision_length)
            if(NOT (revision_length EQUAL 40 OR revision_length EQUAL 64) OR
               NOT declared_GIT_TAG MATCHES "^[0-9a-fA-F]+$")
                message(FATAL_ERROR
                    "Preserving existing ${name} source: safe automatic reuse requires an exact Git commit. "
                    "Set FETCHCONTENT_SOURCE_DIR_${upper_name} explicitly to opt into a development source.")
            endif()
            execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
                "${GIT_EXECUTABLE}" -C "${declared_SOURCE_DIR}" rev-parse HEAD
                RESULT_VARIABLE head_result OUTPUT_VARIABLE existing_head OUTPUT_STRIP_TRAILING_WHITESPACE)
            execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
                "${GIT_EXECUTABLE}" -C "${declared_SOURCE_DIR}" status --porcelain --untracked-files=all --ignore-submodules=none
                RESULT_VARIABLE status_result OUTPUT_VARIABLE existing_status OUTPUT_STRIP_TRAILING_WHITESPACE)
            execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
                "${GIT_EXECUTABLE}" -C "${declared_SOURCE_DIR}" ls-files -v
                RESULT_VARIABLE flags_result OUTPUT_VARIABLE index_flags)
            if(NOT head_result EQUAL 0 OR NOT status_result EQUAL 0 OR NOT flags_result EQUAL 0 OR
               NOT existing_head STREQUAL declared_GIT_TAG OR existing_status OR
               index_flags MATCHES "(^|\n)[a-zS] ")
                message(FATAL_ERROR
                    "Preserving existing ${name} source at ${declared_SOURCE_DIR}: HEAD differs from the declared commit, "
                    "the source is dirty, or index flags can hide edits. Nothing was reset or cloned. "
                    "Set FETCHCONTENT_SOURCE_DIR_${upper_name} explicitly to opt into this development checkout.")
            endif()
            # Function-local only: this is verified reuse of the graph's exact
            # source/pin, not a hidden HOME override or a persistent dev setting.
            # Skipping clone/update also preserves clean unpushed refs and tags.
            # Establish the empty public cache entry first: MakeAvailable would
            # otherwise seed it from the temporary normal variable below.
            set(FETCHCONTENT_SOURCE_DIR_${upper_name} "" CACHE PATH
                "Explicit developer source override for ${name}")
            set(FETCHCONTENT_SOURCE_DIR_${upper_name} "${declared_SOURCE_DIR}")
            set(acquisition verified-existing)
            message(STATUS "psibase: reusing ${name} at ${existing_head} without Git clone/update")
        endif()
    endif()
    # psitri/ucc/psizam only populate sources. Their adapters explicitly add
    # the validated, codec-free engine subset; never evaluate upstream roots.
    FetchContent_MakeAvailable(${name})
    if(name STREQUAL "psio" AND NOT TARGET psio::psio)
        message(FATAL_ERROR "The selected PSIO source did not provide psio::psio")
    endif()
    FetchContent_GetProperties(${name})
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
