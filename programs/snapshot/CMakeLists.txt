add_executable(psibase-create-snapshot create-snapshot.cpp)
target_link_libraries(psibase-create-snapshot psitestlib)
set_target_properties(psibase-create-snapshot PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR}/share/psibase/wasm)

add_executable(psibase-load-snapshot load-snapshot.cpp)
target_link_libraries(psibase-load-snapshot psitestlib)
set_target_properties(psibase-load-snapshot PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR}/share/psibase/wasm)

install(TARGETS psibase-create-snapshot psibase-load-snapshot DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/wasm COMPONENT Client)
