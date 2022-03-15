enable_testing()

add_library( psio INTERFACE )
target_link_libraries( psio INTERFACE rapidjson simdjson )
target_include_directories( psio INTERFACE include ${Boost_INCLUDE_DIRS} )
add_compile_options( -Wall -Wstrict-aliasing )

target_sources( psio INTERFACE
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/fpconv.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/powers.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/compress.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/error.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/reflect.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/schema.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/translator.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/stream.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_key.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/tuple.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/fracpack.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_json.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_json/map.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_json/varint.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/json/any.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/map.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/set.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/list.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/deque.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/varint.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_json.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/varint.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_bin/varint.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_json/varint.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/bytes.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/bytes/from_json.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/bytes/to_json.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/bytes/to_bin.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_protobuf.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_protobuf.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/protobuf/any.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/protobuf/json.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/protobuf/query.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/protobuf/schema.hpp
)

add_subdirectory(tests)
