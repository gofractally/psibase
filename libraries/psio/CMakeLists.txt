enable_testing()

add_library( psio src/fpconv.c )
target_link_libraries( psio INTERFACE rapidjson simdjson consthash )
target_include_directories( psio PUBLIC include ${Boost_INCLUDE_DIRS} )
add_compile_options( -Wall -Wstrict-aliasing )

target_sources( psio INTERFACE
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/fpconv.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/powers.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/compress.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/check.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/reflect.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/schema.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/stream.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_key.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/tuple.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/fracpack.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_json.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_json/map.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/json/any.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/map.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/set.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/list.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/deque.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_json.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/varint.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/bytes.hpp
)

add_subdirectory( consthash )
add_subdirectory(tests)

if(IS_WASM)
    install(DIRECTORY consthash/include/consthash TYPE INCLUDE COMPONENT libpsibase)
    install(FILES consthash/LICENSE DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/licenses RENAME LICENSE.consthash COMPONENT libpsibase)
    install(DIRECTORY include/psio TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.hpp" PATTERN "*.h")
    install(TARGETS psio ARCHIVE COMPONENT libpsibase)
endif()
