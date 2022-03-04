function(contract name)
    add_executable(${name} ${ARGN})
    target_include_directories(${name} PUBLIC include)
    target_link_libraries(${name} psibase-contract-simple-malloc)
    set_target_properties(${name} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add suffix)
    add_library(base_contracts${suffix} INTERFACE)
    target_include_directories(base_contracts${suffix} INTERFACE include)

    if(DEFINED IS_WASM)
        contract(account${suffix} src/account.cpp)
        contract(boot${suffix} src/boot.cpp)
    endif()
endfunction(add)

add("")
add("-debug")
