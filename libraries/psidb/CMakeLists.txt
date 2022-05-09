add_library(psidb STATIC src/page_manager.cpp src/cursor.cpp)
target_include_directories(psidb PUBLIC include)
add_subdirectory(test)
