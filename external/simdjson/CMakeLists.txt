add_library(simdjson_headeronly INTERFACE include/simdjson.h )
target_sources( simdjson_headeronly INTERFACE include/simdjson.h )
target_include_directories( simdjson_headeronly INTERFACE include )

add_library( simdjson simdjson.cpp )
target_sources( simdjson INTERFACE include/simdjson.h )
target_include_directories( simdjson PUBLIC include )
