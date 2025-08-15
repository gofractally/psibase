#[macro_export]
macro_rules! plugin_error {
    (
        $( #[$enum_attrs:meta] )*
            $visibility:vis
            $name:ident
            $( < $($type_params:tt),* > )?
            $(
                $( #[$variant_attrs:meta] )*
                    $variant_name:ident
                    $( { $( $(#[$field_attr:meta])* $field_name:ident : $field_ty:ty ),* } )?
                    $( ( $( $elem_name:ident : $elem_ty:ty ),* ) )?
                    $( = $discriminant:literal )?
                    $( => $msg:literal )?
                    $( $msg_expr:block )?
            ),*
            $(,)?
    ) => {
        $(#[$enum_attrs])*
            #[repr(u32)]
            $visibility
            enum $name
            $( < $($type_params),* > )?
            {
            $(
                $( #[$variant_attrs] )*
                    $variant_name
                    $( { $( $(#[$field_attr])* $field_name : $field_ty),* } )?
                    $( ( $( $elem_ty ),* ) )?
                    $( = $discriminant)?
            ),*
            }


        impl $(<$($type_params),*>)? std::fmt::Display for $name $(<$($type_params),*>)? {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                match self {
                    $($name::$variant_name $( { $( $field_name),* } )? $( ( $( $elem_name ),* ) )? => $(write!(f, $msg))? $( write!(f, "{}", $msg_expr))? ),*
                }
            }
        }

        impl $(<$($type_params),*>)? From<$name $(<$($type_params),*>)?> for crate::bindings::host::types::types::Error {
            fn from(src: $name) -> crate::bindings::host::types::types::Error {
                let (service, plugin) = $crate::component_name!().split_once(':').unwrap();
                crate::bindings::host::types::types::Error {
                    code: unsafe { *(&src as *const $name as *const u32) },
                    producer: crate::bindings::host::types::types::PluginId {
                        service: service.to_string(),
                        plugin: plugin.to_string(),
                    },
                    message: src.to_string(),
                }
            }
        }
    }
}
