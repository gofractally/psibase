function(add suffix)
    add_system_contract("${suffix}" CommonSys src/CommonSys.cpp)
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

conditional_add()
