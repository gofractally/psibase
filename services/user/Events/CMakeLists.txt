function(add suffix)
    add_user_service("${suffix}" Events src/Events.cpp)
    target_link_libraries(Events${suffix} PRIVATE sqlite3)
endfunction(add)

conditional_add()

add_subdirectory(test)
