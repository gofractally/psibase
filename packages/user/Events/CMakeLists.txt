function(add suffix)
    add_library(events-common${suffix} OBJECT src/types.cpp src/eventKeys.cpp src/SchemaCache.cpp)
    target_link_libraries(events-common${suffix} PUBLIC services_system${suffix} services_user${suffix} psibase-service-base${suffix})

    add_user_service("${suffix}" Events src/EventConfig.cpp)
    target_link_libraries(Events${suffix} PRIVATE events-common${suffix})
    add_user_service("${suffix}" EventIndex src/Events.cpp)
    target_link_libraries(EventIndex${suffix} PRIVATE events-common${suffix})
    add_user_service("${suffix}" REvents src/REvents.cpp)
    target_link_libraries(REvents${suffix} PRIVATE sqlite3 events-common${suffix})
endfunction(add)

conditional_add()

add_subdirectory(test)
