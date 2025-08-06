function(add suffix)
    add_system_service("${suffix}" Producers src/Producers.cpp)
    add_system_service("${suffix}" RProducers src/RProducers.cpp)
endfunction(add)

add_subdirectory(test)

conditional_add()
