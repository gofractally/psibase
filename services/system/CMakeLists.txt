function(add_system_service suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_mapped_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} psibase-service-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add suffix)
    add_library(services_system${suffix} INTERFACE)
    target_mapped_include_directories(services_system${suffix} INTERFACE
        Accounts/include
        AuthDelegate/include
        AuthK1/include
        AuthAny/include
        AuthSig/include
        CpuLimit/include
        Producer/include
        HttpServer/include
        SetCode/include
        Transact/include
        VerifyEcSys/include
        VerifySys/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(Accounts)
    add_subdirectory(AuthDelegate)
    add_subdirectory(AuthK1)
    add_subdirectory(AuthAny)
    add_subdirectory(AuthSig)
    add_subdirectory(CpuLimit)
    add_subdirectory(Producer)
    add_subdirectory(HttpServer)
    add_subdirectory(SetCode)
    add_subdirectory(Transact)
    add_subdirectory(VerifyEcSys)
    add_subdirectory(VerifySys)
endif()
