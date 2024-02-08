
#add_executable(triedentdb tdb.cpp)
#target_link_libraries(triedentdb PUBLIC Boost::program_options triedent)
#target_include_directories(triedentdb PUBLIC ${Boost_INCLUDE_DIRS})
#set_target_properties(triedentdb PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

add_executable(arbt arb.cpp)
target_link_libraries(arbt PUBLIC Boost::program_options arbtrie)
target_include_directories(arbt PUBLIC ${Boost_INCLUDE_DIRS})
set_target_properties(arbt PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

add_executable( rprox rprox.cpp )
target_link_libraries(rprox PUBLIC Boost::program_options  )
target_include_directories(rprox PUBLIC ${Boost_INCLUDE_DIRS})
set_target_properties(rprox PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

#add_executable(mermaid mermaid.cpp)
#target_link_libraries(mermaid PUBLIC Boost::program_options triedent)
#target_include_directories(mermaid PUBLIC ${Boost_INCLUDE_DIRS} )
#set_target_properties(mermaid PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
