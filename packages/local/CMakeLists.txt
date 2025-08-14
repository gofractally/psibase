function(add_local_service suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_mapped_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} services_user${suffix} services_local psibase-service-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(${name}${suffix})
endfunction()

add_library(services_local INTERFACE)
target_mapped_include_directories(services_local INTERFACE
    XRun/include
)

if(DEFINED IS_WASM)
    add_subdirectory(XRun)
endif()
