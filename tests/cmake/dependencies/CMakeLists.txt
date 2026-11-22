cmake_minimum_required(VERSION 3.20)
project(psibase_canonical_dependency_proof LANGUAGES CXX)
enable_testing()

set(PSIBASE_DEPENDENCY_PROOF_MODE consumer CACHE STRING
    "consumer, diamond, sentinels, dormant, or collision")
set(PSIBASE_DEPENDENCY_PROOF_PREDECLARE_PSIO_TAG "" CACHE STRING
    "Optional containing-project first declaration, for acquisition proof only")
set(PSIBASE_DEPENDENCY_PROOF_EXPECT_HEAD
    e6901febbe226c93fa31e5aec06bd8f7c12b5ff5 CACHE STRING
    "Exact source revision expected by this proof (also checked for overrides)")

include("${CMAKE_CURRENT_LIST_DIR}/../../../cmake/PsibaseDependencies.cmake")
if(PSIBASE_DEPENDENCY_PROOF_MODE STREQUAL "dormant")
    if(TARGET psio OR TARGET psio::psio)
        message(FATAL_ERROR "Including the dormant module added a PSIO target")
    endif()
    message(STATUS "Dormant dependency module added no targets or sources")
    return()
elseif(PSIBASE_DEPENDENCY_PROOF_MODE STREQUAL "collision")
    add_library(psio INTERFACE)
    psibase_acquire_dependency(psio)
    message(FATAL_ERROR "Canonical acquisition accepted a legacy target collision")
elseif(PSIBASE_DEPENDENCY_PROOF_MODE STREQUAL "sentinels")
    foreach(name psitri ucc psizam)
        string(TOUPPER "${name}" upper_name)
        if(NOT FETCHCONTENT_SOURCE_DIR_${upper_name})
            message(FATAL_ERROR "Pass FETCHCONTENT_SOURCE_DIR_${upper_name} to the sentinel fixture")
        endif()
        psibase_acquire_dependency(${name})
        message(STATUS "Populated ${name}: ${${name}_SOURCE_DIR}; upstream root was not evaluated")
    endforeach()
    return()
elseif(NOT PSIBASE_DEPENDENCY_PROOF_MODE MATCHES "^(consumer|diamond)$")
    message(FATAL_ERROR "Unknown proof mode: ${PSIBASE_DEPENDENCY_PROOF_MODE}")
endif()

if(PSIBASE_DEPENDENCY_PROOF_PREDECLARE_PSIO_TAG)
    # A containing application can choose the graph's single source/pin.
    FetchContent_Declare(psio
        GIT_REPOSITORY https://github.com/gofractally/psio.git
        GIT_TAG "${PSIBASE_DEPENDENCY_PROOF_PREDECLARE_PSIO_TAG}"
        SOURCE_DIR "${CMAKE_BINARY_DIR}/parent-selected-psio")
endif()
psibase_declare_dependencies()
# Acquire through the preservation guard before transitive consumers can call
# raw FetchContent_MakeAvailable. They will then share the populated target.
psibase_acquire_dependency(psio)
if(PSIBASE_DEPENDENCY_PROOF_MODE STREQUAL "diamond")
    # Both leaves try conflicting declarations; the root's choice must win.
    add_subdirectory(leaf leaf-a)
    add_subdirectory(leaf leaf-b)
endif()
if(NOT TARGET psio::psio)
    message(FATAL_ERROR "Canonical PSIO did not export psio::psio")
endif()

find_package(Git REQUIRED)
execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
    "${GIT_EXECUTABLE}" -C "${psio_SOURCE_DIR}" rev-parse HEAD
    RESULT_VARIABLE git_result OUTPUT_VARIABLE actual_head OUTPUT_STRIP_TRAILING_WHITESPACE)
if(NOT git_result EQUAL 0 OR NOT actual_head STREQUAL PSIBASE_DEPENDENCY_PROOF_EXPECT_HEAD)
    message(FATAL_ERROR "Unexpected PSIO source HEAD: ${actual_head}")
endif()
get_filename_component(actual_source "${psio_SOURCE_DIR}" REALPATH)
get_filename_component(psibase_root "${CMAKE_CURRENT_LIST_DIR}/../../.." REALPATH)
if(NOT FETCHCONTENT_SOURCE_DIR_PSIO AND NOT PSIBASE_DEPENDENCY_PROOF_PREDECLARE_PSIO_TAG)
    if(NOT actual_source STREQUAL "${psibase_root}/external/psio")
        message(FATAL_ERROR "Fetched source is not anchored to the psibase root: ${actual_source}")
    endif()
endif()
execute_process(COMMAND "${CMAKE_COMMAND}" -E env GIT_OPTIONAL_LOCKS=0
    "${GIT_EXECUTABLE}" -C "${psio_SOURCE_DIR}" status --porcelain
    RESULT_VARIABLE status_result OUTPUT_VARIABLE source_status OUTPUT_STRIP_TRAILING_WHITESPACE)
if(NOT status_result EQUAL 0)
    message(FATAL_ERROR "Could not inspect PSIO source status")
endif()
if(source_status)
    if(NOT FETCHCONTENT_SOURCE_DIR_PSIO)
        message(FATAL_ERROR "Fetched pinned PSIO source has local changes: ${source_status}")
    endif()
    message(STATUS "PSIO source has local changes (development override): ${source_status}")
endif()
file(WRITE "${CMAKE_BINARY_DIR}/psio-source.txt"
    "source=${actual_source}\nhead=${actual_head}\noverride=${FETCHCONTENT_SOURCE_DIR_PSIO}\nstatus=${source_status}\n")
message(STATUS "Canonical PSIO source: ${actual_source} at ${actual_head}")

add_executable(canonical-psio-consumer consumer.cpp)
target_link_libraries(canonical-psio-consumer PRIVATE psio::psio)
add_test(NAME canonical-psio-consumer COMMAND canonical-psio-consumer)
