add_library(psibase_http http.cpp)
target_include_directories(psibase_http PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(psibase_http PUBLIC psibase)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
