function(add suffix)
    add_system_service("${suffix}" CommonApi src/CommonApi.cpp)
endfunction(add)

include(ExternalProject)

downloadThirdParty("htm" "https://unpkg.com/htm@3.1.0/dist/htm.module.js")
downloadThirdParty("react.production" "https://unpkg.com/react@18/umd/react.production.min.js")
downloadThirdParty("react-dom.production" "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js")

conditional_add()
