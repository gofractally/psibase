function(add suffix)
    add_system_service("${suffix}" CommonSys src/CommonSys.cpp)
endfunction(add)

include(ExternalProject)

downloadThirdParty("htm" "https://unpkg.com/htm@3.1.0/dist/htm.module.js")
downloadThirdParty("iframeResizer" "https://unpkg.com/iframe-resizer@4.3.1/js/iframeResizer.js")
downloadThirdParty("iframeResizerContent" "https://unpkg.com/iframe-resizer@4.3.1/js/iframeResizer.contentWindow.js")
downloadThirdParty("react.production" "https://unpkg.com/react@18/umd/react.production.min.js")
downloadThirdParty("react-dom.production" "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js")
downloadThirdParty("react.development" "https://unpkg.com/react@18/umd/react.development.js")
downloadThirdParty("react-dom.development" "https://unpkg.com/react-dom@18/umd/react-dom.development.js")
downloadThirdParty("react-router-dom" "https://unpkg.com/react-router-dom@5.3.3/umd/react-router-dom.min.js")
downloadThirdParty("semantic-ui-react" "https://cdn.jsdelivr.net/npm/semantic-ui-react/dist/umd/semantic-ui-react.min.js")
downloadThirdParty("use-local-storage-state" "https://cdn.jsdelivr.net/npm/use-local-storage-state@18.1.0/src/useLocalStorageState.js")

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
