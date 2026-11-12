function(add suffix)
    add_system_service("${suffix}" AuthScope src/AuthScope.cpp)
    target_link_libraries(AuthScope${suffix} PUBLIC Spki${suffix})
endfunction(add)

add_subdirectory(test)

conditional_add()
