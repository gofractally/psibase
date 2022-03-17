add_library( simdjson simdjson.cpp )
target_sources( simdjson  PRIVATE simdjson.cpp )
target_include_directories( simdjson PUBLIC include )
