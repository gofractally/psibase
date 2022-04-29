add_library(psidb STATIC src/page_manager.cpp)
target_include_directories(psidb PUBLIC include)
add_subdirectory(test)
