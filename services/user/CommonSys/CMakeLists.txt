function(add suffix)
    add_system_service("${suffix}" CommonSys src/CommonSys.cpp)
endfunction(add)

include(ExternalProject)

conditional_add()
