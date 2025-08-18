function(add_system_service suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_mapped_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} services_local psibase-service-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(${name}${suffix})
endfunction()

function(add_system_service_full_malloc suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_mapped_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} services_local psibase-service${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(${name}${suffix})
endfunction()

function(add_system_test_impl suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_include_directories(${TARGET} PUBLIC
      ../include
     ${CMAKE_CURRENT_LIST_DIR})
    target_link_libraries(${TARGET} services_system${suffix} services_test psitestlib${suffix} catch2)
    set_target_properties(${TARGET} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add_system_test_release name)
    if(BUILD_RELEASE_WASM)
        add_system_test_impl("" ${name} ${ARGN})
        add_wasm_test(${name}-test)
    endif()
endfunction()

function(add_system_test_debug name)
    if(BUILD_DEBUG_WASM)
        add_system_test_impl("-debug" ${name} ${ARGN})
    endif()
endfunction()

function(add_system_test name)
    add_system_test_release(${name} ${ARGN})
    add_system_test_debug(${name} ${ARGN})
endfunction()

function(add suffix)
    add_library(services_system${suffix} INTERFACE)
    target_mapped_include_directories(services_system${suffix} INTERFACE
        Accounts/include
        AuthDelegate/include
        AuthAny/include
        AuthSig/include
        CpuLimit/include
        Producers/include
        HttpServer/include
        SetCode/include
        StagedTx/service/cpp/include
        Transact/include
        VerifySig/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(Accounts)
    add_subdirectory(AuthDelegate)
    add_subdirectory(AuthAny)
    add_subdirectory(AuthSig)
    add_subdirectory(CpuLimit)
    add_subdirectory(Producers)
    add_subdirectory(HttpServer)
    add_subdirectory(SetCode)
    add_subdirectory(Transact)
    add_subdirectory(VerifySig)
endif()
