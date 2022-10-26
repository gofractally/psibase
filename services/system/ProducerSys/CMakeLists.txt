function(add suffix)
    add_system_service("${suffix}" ProducerSys src/ProducerSys.cpp)
    add_system_service("${suffix}" RProducerSys src/RProducerSys.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
