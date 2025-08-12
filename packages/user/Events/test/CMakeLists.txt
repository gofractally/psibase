function(add suffix)
    add_user_service("${suffix}" Events-TestService TestService.cpp)
endfunction(add)

conditional_add()

add_user_test(Events EventsTest.cpp)
