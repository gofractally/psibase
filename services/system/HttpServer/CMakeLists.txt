function(add suffix)
    add_system_service_full_malloc("${suffix}" HttpServer src/HttpServer.cpp)
    add_system_service("${suffix}" RHttpServer src/RHttpServer.cpp)
endfunction(add)

conditional_add()
