# All cmake projects need these
cmake_minimum_required(VERSION 3.16)
project(example)

# Generate compile_commands.json to aid vscode and other editors
set(CMAKE_EXPORT_COMPILE_COMMANDS on)

# Libraries for building services and tests
find_package(psibase REQUIRED)

# Build arithmetic.wasm service
add_executable(arithmetic arithmetic.cpp)
target_link_libraries(arithmetic Psibase::service)

# Build caller.wasm service
add_executable(caller caller.cpp)
target_link_libraries(caller Psibase::service)

psibase_package(
    NAME Calling
    VERSION 1.0.0
    DESCRIPTION "Calling services"
    SERVICE arithmetic
        TARGET arithmetic
        SERVER arithmetic
    SERVICE caller
        TARGET caller
        SERVER caller
)
