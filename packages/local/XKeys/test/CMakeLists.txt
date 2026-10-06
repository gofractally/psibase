function(add suffix)
    add_local_service("${suffix}" XKeysCaller XKeysCaller.cpp)
    target_link_libraries(XKeysCaller${suffix} PUBLIC Spki${suffix})
endfunction(add)

conditional_add()

add_local_test(XKeys XKeys-test.cpp)
