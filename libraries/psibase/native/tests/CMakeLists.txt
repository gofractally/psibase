find_package(Threads REQUIRED)

add_executable(QueryCpuProfileTests QueryCpuProfileTests.cpp)
target_include_directories(QueryCpuProfileTests PRIVATE ../include)
target_link_libraries(QueryCpuProfileTests PRIVATE Threads::Threads)
target_compile_definitions(QueryCpuProfileTests PRIVATE PSIBASE_VM_WASMTIME)
foreach(mode ledger disabled enabled conflict signal-owner snapshot-active partition)
    add_test(NAME QueryCpuProfile_${mode} COMMAND QueryCpuProfileTests ${mode})
    set_tests_properties(QueryCpuProfile_${mode} PROPERTIES TIMEOUT 15)
endforeach()
add_executable(QueryCpuProfileUnsupportedTests QueryCpuProfileTests.cpp)
target_include_directories(QueryCpuProfileUnsupportedTests PRIVATE ../include)
target_link_libraries(QueryCpuProfileUnsupportedTests PRIVATE Threads::Threads)
add_test(NAME QueryCpuProfile_unsupported COMMAND QueryCpuProfileUnsupportedTests unsupported)
set_tests_properties(QueryCpuProfile_unsupported PROPERTIES TIMEOUT 15)

add_executable(WatchdogTests WatchdogTests.cpp)
target_link_directories(WatchdogTests PUBLIC ${ICU_LIBRARY_DIR})
target_link_libraries(WatchdogTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME WatchdogTests COMMAND WatchdogTests)

set_tests_properties(WatchdogTests PROPERTIES PROCESSORS 2)

add_executable(CpuAccountingContract storage/cpu_accounting_contract.cpp)
target_link_directories(CpuAccountingContract PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(CpuAccountingContract PRIVATE psibase Threads::Threads)
add_test(NAME CpuAccountingContract COMMAND CpuAccountingContract)
set_tests_properties(CpuAccountingContract PROPERTIES TIMEOUT 30)

if(APPLE)
    add_executable(DarwinCpuContract storage/darwin_cpu_contract.cpp)
    target_link_directories(DarwinCpuContract PRIVATE ${ICU_LIBRARY_DIR})
    target_link_libraries(DarwinCpuContract PRIVATE psibase Threads::Threads)
    add_test(NAME DarwinCpuLifetimeIo COMMAND DarwinCpuContract)
    foreach(mode previous blocked replaced)
        add_test(NAME DarwinCpu_${mode} COMMAND DarwinCpuContract ${mode})
    endforeach()
    set_tests_properties(DarwinCpuLifetimeIo DarwinCpu_previous DarwinCpu_blocked
        DarwinCpu_replaced PROPERTIES TIMEOUT 30)
endif()

add_executable(saturatingTests saturatingTests.cpp)
target_link_directories(saturatingTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(saturatingTests psibase)

add_executable(MountTests MountTests.cpp)
target_compile_definitions(MountTests PUBLIC -DCATCH_CONFIG_ENABLE_ALL_STRINGMAKERS=1)
target_link_directories(MountTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(MountTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME MountTests COMMAND MountTests)

add_executable(SecretsTests SecretsTests.cpp)
target_compile_definitions(SecretsTests PUBLIC -DCATCH_CONFIG_ENABLE_ALL_STRINGMAKERS=1)
target_link_directories(SecretsTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(SecretsTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME SecrestsTests COMMAND SecretsTests)

add_executable(PsitriDatabaseTests PsitriDatabaseTests.cpp)
target_compile_definitions(PsitriDatabaseTests PRIVATE PSIBASE_STORAGE_TEST_ROOT="${ROOT_BINARY_DIR}/storage-contract-databases")
target_link_directories(PsitriDatabaseTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(PsitriDatabaseTests PRIVATE psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME PsitriDatabaseTests COMMAND PsitriDatabaseTests)

# Keep the VM's trap handlers in charge; this bounded standalone consumer does
# not install Catch2 fatal-signal handlers over the native runtime.
add_executable(StorageTimeoutTests StorageTimeoutTests.cpp)
target_link_directories(StorageTimeoutTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(StorageTimeoutTests PRIVATE psibase Threads::Threads)
add_test(NAME StorageTimeoutTests COMMAND StorageTimeoutTests)
set_tests_properties(StorageTimeoutTests PROPERTIES TIMEOUT 30 PROCESSORS 2)

# The fixture exercises the actual registered-host ABI and native code writer.
find_program(PSIZAM_WAT2WASM NAMES wat2wasm REQUIRED)
set(PSIZAM_POLICY_WASM "${CMAKE_CURRENT_BINARY_DIR}/psizam-policy.wasm")
set(PSIZAM_SERVICE_WASM "${CMAKE_CURRENT_BINARY_DIR}/psizam-service.wasm")
foreach(fixture policy service)
    add_custom_command(OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/psizam-${fixture}.wasm"
        COMMAND "${PSIZAM_WAT2WASM}" "${CMAKE_CURRENT_SOURCE_DIR}/psizam-${fixture}.wat"
            -o "${CMAKE_CURRENT_BINARY_DIR}/psizam-${fixture}.wasm"
        DEPENDS "psizam-${fixture}.wat" VERBATIM)
endforeach()
add_executable(PsizamTests PsizamTests.cpp "${PSIZAM_POLICY_WASM}" "${PSIZAM_SERVICE_WASM}")
target_compile_definitions(PsizamTests PRIVATE
    PSIBASE_PSIZAM_POLICY_WASM="${PSIZAM_POLICY_WASM}"
    PSIBASE_PSIZAM_SERVICE_WASM="${PSIZAM_SERVICE_WASM}")
target_link_directories(PsizamTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(PsizamTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME PsizamTests COMMAND PsizamTests)
set_tests_properties(PsizamTests PROPERTIES TIMEOUT 30)

find_package(Python3 COMPONENTS Interpreter REQUIRED)
add_test(NAME PsizamAltTimeout
    COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/run_psizam_alt_timeout.py"
        "$<TARGET_FILE:PsizamTests>")
set_tests_properties(PsizamAltTimeout PROPERTIES TIMEOUT 15 PROCESSORS 2)

set(vm_consensus_wasms)
set(vm_consensus_definitions)
foreach(fixture values traps atomics private-atomics relaxed relaxed-math tail dynamic-table secondary-table reentry)
    set(output "${CMAKE_CURRENT_BINARY_DIR}/vm-consensus-${fixture}.wasm")
    add_custom_command(OUTPUT "${output}"
        COMMAND "${PSIZAM_WAT2WASM}" --enable-threads --enable-relaxed-simd --enable-tail-call
            "${CMAKE_CURRENT_SOURCE_DIR}/vm-consensus-${fixture}.wat" -o "${output}"
        DEPENDS "vm-consensus-${fixture}.wat" VERBATIM)
    list(APPEND vm_consensus_wasms "${output}")
    string(REPLACE "-" "_" upper_fixture "${fixture}")
    string(TOUPPER "${upper_fixture}" upper_fixture)
    list(APPEND vm_consensus_definitions "PSIBASE_VM_CONSENSUS_${upper_fixture}_WASM=\"${output}\"")
endforeach()
if(PSIBASE_VM_BACKEND STREQUAL "LLVM_AOT")
    add_executable(VmConsensusTests VmConsensusTests.cpp ${vm_consensus_wasms})
    target_compile_definitions(VmConsensusTests PRIVATE ${vm_consensus_definitions})
    target_link_directories(VmConsensusTests PRIVATE ${ICU_LIBRARY_DIR})
    target_link_libraries(VmConsensusTests PRIVATE psibase Catch2::Catch2WithMain Threads::Threads)
    add_test(NAME VmConsensusTests COMMAND VmConsensusTests)
    set_tests_properties(VmConsensusTests PROPERTIES TIMEOUT 120 PROCESSORS 2)
endif()

# An opt-in replay of a captured existing proof-bearing block. Its input must
# include the exact pre-block bytes and recorded subjective data; no fixture is
# generated by this target and no proof timeout is bypassed.
add_executable(VmConsensusReplay VmConsensusReplay.cpp)
target_link_directories(VmConsensusReplay PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(VmConsensusReplay PRIVATE psibase Threads::Threads)

if(PSIBASE_VM_BACKEND STREQUAL "WASMTIME")
    # Reads module files; see the comment in the source for how it is used.
    add_executable(VmAdmissionFuzz VmAdmissionFuzz.cpp)
    target_link_directories(VmAdmissionFuzz PRIVATE ${ICU_LIBRARY_DIR})
    target_link_libraries(VmAdmissionFuzz PRIVATE psibase Threads::Threads)
endif()

add_executable(NativeAotCacheTests NativeAotCacheTests.cpp ../src/NativeAotCache.cpp)
target_include_directories(NativeAotCacheTests PRIVATE ../include)
target_compile_definitions(NativeAotCacheTests PRIVATE PSIBASE_NATIVE_AOT_CACHE_TEST_IO)
target_link_libraries(NativeAotCacheTests PRIVATE Threads::Threads)
add_test(NAME NativeAotCacheTests COMMAND NativeAotCacheTests)
set_tests_properties(NativeAotCacheTests PROPERTIES TIMEOUT 30 PROCESSORS 2)

if(PSIBASE_VM_BACKEND STREQUAL "LLVM_AOT")
    add_executable(VmSdkConstructorDiagnostic VmSdkConstructorDiagnostic.cpp)
    target_link_directories(VmSdkConstructorDiagnostic PRIVATE ${ICU_LIBRARY_DIR})
    target_link_libraries(VmSdkConstructorDiagnostic PRIVATE psibase Threads::Threads)
endif()
