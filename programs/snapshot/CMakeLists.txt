add_executable(psibase-create-snapshot create-snapshot.cpp)
target_link_libraries(psibase-create-snapshot psitestlib)
set_target_properties(psibase-create-snapshot PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

add_executable(psibase-load-snapshot load-snapshot.cpp)
target_link_libraries(psibase-load-snapshot psitestlib)
set_target_properties(psibase-load-snapshot PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
