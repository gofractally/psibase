use crate::wasm::host;
use crate::wasm::types;

pub unsafe trait PluginError: std::fmt::Display {}

impl<T: PluginError> From<T> for types::Error {
    fn from(src: T) -> Self {
        let code = unsafe { *(&src as *const T as *const u32) };
        types::Error {
            code,
            producer: types::PluginId {
                service: host::client::get_receiver(),
                plugin: "plugin".to_string(), // TODO: I think we should just remove the plugin name from the error type
            },
            message: src.to_string(),
        }
    }
}
