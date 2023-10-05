function(add suffix)
    add_system_service("${suffix}" CommonSys src/CommonSys.cpp)
endfunction(add)

include(ExternalProject)

downloadThirdParty("htm" "https://unpkg.com/htm@3.1.0/dist/htm.module.js")
downloadThirdParty("iframeResizer" "https://unpkg.com/iframe-resizer@4.3.1/js/iframeResizer.js")
downloadThirdParty("iframeResizerContent" "https://unpkg.com/iframe-resizer@4.3.1/js/iframeResizer.contentWindow.js")
downloadThirdParty("use-local-storage-state" "https://cdn.jsdelivr.net/npm/use-local-storage-state@18.1.0/src/useLocalStorageState.js")

conditional_add()
