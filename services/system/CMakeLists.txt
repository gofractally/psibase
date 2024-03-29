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
        AuthEc/include
        AuthAny/include
        AuthBasic/include
        CpuSys/include
        ProducerSys/include
        ProxySys/include
        SetCodeSys/include
        TransactionSys/include
        VerifyEcSys/include
        VerifySys/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(Accounts)
    add_subdirectory(AuthDelegate)
    add_subdirectory(AuthEc)
    add_subdirectory(AuthAny)
    add_subdirectory(AuthBasic)
    add_subdirectory(CpuSys)
    add_subdirectory(ProducerSys)
    add_subdirectory(ProxySys)
    add_subdirectory(SetCodeSys)
    add_subdirectory(TransactionSys)
    add_subdirectory(VerifyEcSys)
    add_subdirectory(VerifySys)
endif()
