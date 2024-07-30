function(add_user_service suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC
        include
    )
    target_link_libraries(${name}${suffix} PUBLIC services_system${suffix} services_user${suffix} psibase-service-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add_user_service)

function(add_user_test_impl suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_include_directories(${TARGET} PUBLIC
      ../include
     ${CMAKE_CURRENT_LIST_DIR})
    target_link_libraries(${TARGET} services_system${suffix} services_user${suffix} psitestlib${suffix})
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
        CommonApi/include
        Events/include
        Fractal/include
        Invite/include
        Nft/include
        Sites/include
        Symbol/include
        Tokens/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(CommonApi)
    add_subdirectory(Email)
    add_subdirectory(Events)
    add_subdirectory(Explorer)
    add_subdirectory(Fractal)
    add_subdirectory(Invite)
    add_subdirectory(SimpleService)
    add_subdirectory(Nft)
    add_subdirectory(Nop)
    add_subdirectory(Packages)
    add_subdirectory(Sites)
    add_subdirectory(Symbol)
    add_subdirectory(Tokens)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
