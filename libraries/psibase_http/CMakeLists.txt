if(ENABLE_SSL)
    if (BUILD_STATIC)
        set(OPENSSL_USE_STATIC_LIBS TRUE)
    endif()
    find_package(OpenSSL REQUIRED SSL)
endif()

add_library(psibase_http
    http.cpp
    handle_request.cpp
    http_session_base.cpp
    tcp_http_session.cpp
    tls_http_session.cpp
    unix_http_session.cpp
    websocket_log_session.cpp
    send_request.cpp)
target_include_directories(psibase_http PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(psibase_http PUBLIC psibase)

if(ENABLE_SSL)
    target_compile_definitions(psibase_http PUBLIC PSIBASE_ENABLE_SSL)
    target_link_libraries(psibase_http PUBLIC OpenSSL::SSL)
endif()
