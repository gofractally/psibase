# All cmake projects need these
cmake_minimum_required(VERSION 3.16)
project(__contract__)

# Generate compile_commands.json to aid vscode and other editors
set(CMAKE_EXPORT_COMPILE_COMMANDS on)

# psidk requires C++20
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Libraries for building services and tests
find_package(psibase REQUIRED)

# Build example.wasm service
add_executable(__contract__ src/__contract__.cpp)
target_link_libraries(__contract__ Psibase::service)

# These symlinks help vscode
execute_process(COMMAND ln -sfT ${psidk_DIR} ${CMAKE_CURRENT_BINARY_DIR}/psidk)
execute_process(COMMAND ln -sfT ${WASI_SDK_PREFIX} ${CMAKE_CURRENT_BINARY_DIR}/wasi-sdk)
