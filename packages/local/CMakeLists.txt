function(add_local_service suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_mapped_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} services_user${suffix} services_local psibase-service${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(${name}${suffix})
endfunction()

add_library(services_local INTERFACE)
target_mapped_include_directories(services_local INTERFACE
    XAdmin/include
    XDb/include
    XHttp/include
    XPackages/include
    XRun/include
    XSites/include
    XTimer/include
    XTransact/include
)

if(DEFINED IS_WASM)
    add_subdirectory(XAdmin)
    add_subdirectory(XDb)
    add_subdirectory(XHttp)
    add_subdirectory(XPackages)
    add_subdirectory(XRun)
    add_subdirectory(XSites)
    add_subdirectory(XTimer)
    add_subdirectory(XTransact)
endif()
