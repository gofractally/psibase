function(add suffix)
    add_system_service("${suffix}" Producer src/Producer.cpp)
    add_system_service("${suffix}" RProducer src/RProducer.cpp)
endfunction(add)

conditional_add()
