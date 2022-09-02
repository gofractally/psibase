# All cmake projects need these
cmake_minimum_required(VERSION 3.16)
project(example)

# Generate compile_commands.json to aid vscode and other editors
set(CMAKE_EXPORT_COMPILE_COMMANDS on)

# psidk requires C++20
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Libraries for building services and tests
find_package(psidk REQUIRED)

# Build arithmetic.wasm service
add_executable(arithmetic arithmetic.cpp)
target_link_libraries(arithmetic psibase-service-simple-malloc)

# Build caller.wasm service
add_executable(caller caller.cpp)
target_link_libraries(caller psibase-service-simple-malloc)

# These symlinks help vscode
execute_process(COMMAND ln -sfT ${psidk_DIR} ${CMAKE_CURRENT_BINARY_DIR}/psidk)
execute_process(COMMAND ln -sfT ${WASI_SDK_PREFIX} ${CMAKE_CURRENT_BINARY_DIR}/wasi-sdk)
