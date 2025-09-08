function(add_local_service_impl suffix malloc name)
    add_executable(${name}${suffix} ${ARGN})
    target_mapped_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} services_user${suffix} services_local psibase-service${malloc}${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(${name}${suffix})
endfunction()

function(add_local_service suffix name)
    add_local_service_impl("${suffix}" -simple-malloc ${name} ${ARGN})
endfunction()

function(add_local_service_full_malloc suffix name)
    add_local_service_impl("${suffix}" "" ${name} ${ARGN})
endfunction()

add_library(services_local INTERFACE)
target_mapped_include_directories(services_local INTERFACE
    XAdmin/include
    XHttp/include
    XRun/include
    XSites/include
    XTransact/include
)

if(DEFINED IS_WASM)
    add_subdirectory(XAdmin)
    add_subdirectory(XHttp)
    add_subdirectory(XRun)
    add_subdirectory(XSites)
    add_subdirectory(XTransact)
endif()
