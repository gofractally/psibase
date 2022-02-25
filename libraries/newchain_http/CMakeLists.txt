add_library(newchain_http http.cpp)
target_include_directories(newchain_http PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(newchain_http PUBLIC newchain)
