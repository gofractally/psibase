function(add suffix)
    add_executable(nc-test${suffix} nc-test.cpp)
    target_include_directories(nc-test${suffix} PUBLIC include)
    target_link_libraries(nc-test${suffix} nctestlib)
    set_target_properties(nc-test${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

add("")
add("-debug")
