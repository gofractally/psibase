add_executable(arbtrie-tests
    arbtrie-tests.cpp
    )
target_link_libraries(arbtrie-tests PUBLIC catch2 arbtrie)
target_include_directories(arbtrie-tests PUBLIC ${Boost_INCLUDE_DIRS})
set_target_properties(arbtrie-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
native_test(arbtrie-tests)

#add_executable(arbtrie-tests-bigdb big.cpp)
#target_link_libraries(arbtrie-tests-bigdb PUBLIC Boost::program_options arbtrie)
#target_include_directories(arbtrie-tests-bigdb PUBLIC ${Boost_INCLUDE_DIRS})
#set_target_properties(arbtrie-tests-bigdb PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})


