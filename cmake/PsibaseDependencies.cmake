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
        GIT_TAG 6cff821fdf341cc6512ba214dd4da8318ecb59a4
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
        # Refuse accidental co-linking during the phased migration.
        if((TARGET psio OR TARGET psio::psio) AND NOT psio_POPULATED)
            message(FATAL_ERROR
                "A PSIO target already exists outside this FetchContent dependency. "
                "Retire the legacy PSIO target before activating canonical PSIO; "
                "installed-package consumers should use find_package directly.")
        endif()
    endif()
    # psitri/ucc/psizam only populate sources. Their adapters explicitly add
    # the validated, codec-free engine subset; never evaluate upstream roots.
    FetchContent_MakeAvailable(${name})
    if(name STREQUAL "psio" AND NOT TARGET psio::psio)
        message(FATAL_ERROR "The selected PSIO source did not provide psio::psio")
    endif()
    FetchContent_GetProperties(${name})
    set(${name}_SOURCE_DIR "${${name}_SOURCE_DIR}" PARENT_SCOPE)
    set(${name}_BINARY_DIR "${${name}_BINARY_DIR}" PARENT_SCOPE)
endfunction()
