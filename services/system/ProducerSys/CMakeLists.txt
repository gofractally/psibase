function(add suffix)
    add_system_service("${suffix}" ProducerSys src/ProducerSys.cpp)
endfunction(add)

conditional_add()
