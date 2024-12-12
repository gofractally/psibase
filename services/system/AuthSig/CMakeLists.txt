function(add suffix)
    add_system_service("${suffix}" AuthSig src/AuthSig.cpp)
    add_system_service("${suffix}" RAuthSig src/RAuthSig.cpp)
    
    add_library(Spki${suffix} src/Spki.cpp)
    target_link_libraries(Spki${suffix} PUBLIC -lbotan-3 services_system${suffix} psibase${suffix} exception-stub${suffix})
    target_include_directories(Spki${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3 include)
    target_link_options(Spki${suffix} PUBLIC 
        -Wl,-z,stack-size=32768
    )

    add_library(PrivateKeyInfo${suffix} src/PrivateKeyInfo.cpp)
    target_link_libraries(PrivateKeyInfo${suffix} PUBLIC -lbotan-3 services_system${suffix} psibase${suffix} exception-stub${suffix})
    target_include_directories(PrivateKeyInfo${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3 include)

    target_link_libraries(AuthSig${suffix} PUBLIC Spki${suffix})
    target_link_libraries(RAuthSig${suffix} PUBLIC Spki${suffix})

    install(TARGETS Spki${suffix} PrivateKeyInfo${suffix} ARCHIVE COMPONENT libpsibase)

endfunction(add)

add_subdirectory(test)

conditional_add()
