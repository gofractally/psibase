function(add_local_service suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_mapped_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} services_user${suffix} services_local psibase-service${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(${name}${suffix})
endfunction()

function(add_local_test_impl suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_link_libraries(${TARGET} services_local services_test psitestlib${suffix} catch2)
    set_target_properties(${TARGET} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add_local_test name)
    if(BUILD_RELEASE_WASM)
        add_local_test_impl("" ${name} ${ARGN})
        add_wasm_test(${name}-test)
    endif()
    if(BUILD_DEBUG_WASM)
        add_local_test_impl("-debug" ${name} ${ARGN})
    endif()
endfunction()

add_library(services_local INTERFACE)
target_mapped_include_directories(services_local INTERFACE
    XAdmin/include
    XBasic/include
    XDb/include
    XHttp/include
    XPackages/include
    XPeers/include
    XProxy/include
    XRun/include
    XSites/include
    XTimer/include
    XTransact/include
)

if(DEFINED IS_WASM)
    add_subdirectory(XAdmin)
    add_subdirectory(XBasic)
    add_subdirectory(XDb)
    add_subdirectory(XHttp)
    add_subdirectory(XPackages)
    add_subdirectory(XPeers)
    add_subdirectory(XProxy)
    add_subdirectory(XRun)
    add_subdirectory(XSites)
    add_subdirectory(XTimer)
    add_subdirectory(XTransact)
endif()
