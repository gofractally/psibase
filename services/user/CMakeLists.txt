function(add_user_service suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC
        include
        ../CommonApi/include
        ../Fractal/include
        ../Invite/include
        ../Nft/include
        ../PsiSpaceSys/include
        ../SymbolSys/include
        ../TokenSys/include
        ../../system/Accounts/include
        ../../system/AuthK1/include
        ../../system/AuthAny/include
        ../../system/SetCode/include
        ../../system/Transact/include
        ../../system/VerifyK1/include
    )
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} psibase-service-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add_user_service)

function(add_user_test_impl suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_include_directories(${TARGET} PUBLIC
      ../include
      ../../CommonApi/include
      ../../Fractal/include
      ../../Invite/include
      ../../Nft/include
      ../../PsiSpaceSys/include
      ../../SymbolSys/include
      ../../TokenSys/include
      ../../../system/Accounts/include
      ../../../system/AuthK1/include
      ../../../system/AuthAny/include
      ../../../system/SetCode/include
      ../../../system/Transact/include
      ../../../system/VerifyK1/include
     ${CMAKE_CURRENT_LIST_DIR})
    target_link_libraries(${TARGET} services_system${suffix} psitestlib${suffix})
    set_target_properties(${TARGET} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add_user_test_release name)
    if(BUILD_RELEASE_WASM)
        add_user_test_impl("" ${name} ${ARGN})
        add_wasm_test(${name}-test)
    endif()
endfunction()

function(add_user_test_debug name)
    if(BUILD_DEBUG_WASM)
        add_user_test_impl("-debug" ${name} ${ARGN})
    endif()
endfunction()

function(add_user_test name)
    add_user_test_release(${name} ${ARGN})
    add_user_test_debug(${name} ${ARGN})
endfunction()

function(add suffix)
    add_library(services_user${suffix} INTERFACE)
    target_include_directories(services_user${suffix} INTERFACE
        Nft/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(CommonApi)
    add_subdirectory(Invite)
    add_subdirectory(Explorer)
    add_subdirectory(Fractal)
    add_subdirectory(SimpleService)
    add_subdirectory(Nft)
    add_subdirectory(Nop)
    add_subdirectory(Packages)
    add_subdirectory(PsiSpaceSys)
    add_subdirectory(SymbolSys)
    add_subdirectory(TokenSys)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
