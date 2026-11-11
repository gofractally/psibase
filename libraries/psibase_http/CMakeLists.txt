if(ENABLE_SSL)
    if (BUILD_STATIC)
        set(OPENSSL_USE_STATIC_LIBS TRUE)
    endif()
    find_package(OpenSSL REQUIRED SSL)
endif()

add_library(psibase_http
    http.cpp
    close.cpp
    handle_request.cpp
    http_session_base.cpp
    tcp_http_session.cpp
    tls_http_session.cpp
    unix_http_session.cpp
    websocket_log_session.cpp
    send_request.cpp
    websocket.cpp)
target_include_directories(psibase_http PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(psibase_http PUBLIC psibase psibase_net)

if(ENABLE_SSL)
    target_compile_definitions(psibase_http PUBLIC PSIBASE_ENABLE_SSL)
    target_link_libraries(psibase_http PUBLIC OpenSSL::SSL)
endif()

add_executable(psibase-http-tests tests/set_cookie_merge.cpp)
target_include_directories(psibase-http-tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(psibase-http-tests PRIVATE psibase_http Catch2::Catch2WithMain)
set_target_properties(psibase-http-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
add_test(
    NAME n-psibase-http-tests
    WORKING_DIRECTORY ${ROOT_BINARY_DIR}
    COMMAND ./psibase-http-tests)
