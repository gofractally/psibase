# All cmake projects need these
cmake_minimum_required(VERSION 3.16)
project(example)

# Generate compile_commands.json to aid vscode and other editors
set(CMAKE_EXPORT_COMPILE_COMMANDS on)

# Libraries for building services and tests
find_package(psibase REQUIRED)

# Build example.wasm service
add_executable(example example.cpp)
target_link_libraries(example Psibase::service)

psibase_package(
    NAME MinimalUI
    VERSION 1.0.0
    DESCRIPTION "An example service with the minimal UI"
    SERVICE example
    TARGET example
)
