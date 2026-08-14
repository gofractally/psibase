use anyhow::{Context, Result, bail};
use indexmap::IndexMap;
use std::collections::HashMap;
use wit_component::{
    ComponentEncoder, StringEncoding, decode, embed_component_metadata,
};
use wit_parser::abi::WasmType;
use wit_parser::{
    Function, FunctionKind, Handle, InterfaceId, LiftLowerAbi, ManglingAndAbi, Resolve,
    ResourceIntrinsic, Stability, Type, TypeDefKind, TypeId, WasmExport, WasmExportKind,
    WasmImport, World, WorldId, WorldItem, WorldKey,
};

const CALLSTACK_WIT: &str = r#"
package supervisor:callstack;

interface callstack {
    push: func(service: string);
    pop: func();
}
"#;

const MANGLING: ManglingAndAbi = ManglingAndAbi::Legacy(LiftLowerAbi::Sync);

/// Generate a trampoline component that imports and exports the same
/// interfaces as `plugin_wasm`, wrapping each exported function with
/// `supervisor:callstack` push/pop. The inner plugin is plugged into this
/// socket by the composer.
pub fn make_tracer(plugin_wasm: &[u8], service: &str) -> Result<Vec<u8>> {
    let decoded = decode(plugin_wasm).context("decode plugin for tracer")?;
    let (mut resolve, world_id) = match decoded {
        wit_component::DecodedWasm::Component(resolve, world) => (resolve, world),
        wit_component::DecodedWasm::WitPackage(_, _) => {
            bail!("plugin is a WIT package, not a component")
        }
    };

    if !world_has_exported_funcs(&resolve, world_id) {
        bail!("plugin exports no functions; cannot wrap with a tracer");
    }

    let callstack_pkg = resolve
        .push_str("callstack.wit", CALLSTACK_WIT)
        .context("add supervisor:callstack to tracer resolve")?;
    let callstack_iface = *resolve.packages[callstack_pkg]
        .interfaces
        .get("callstack")
        .context("callstack interface missing")?;

    let plugin_world = resolve.worlds[world_id].clone();
    // Exported interfaces often `use` foreign types (e.g. host:types/error).
    // encode_world panics unless those owner interfaces are world imports.
    let mut imports = IndexMap::new();
    for (_, item) in plugin_world.exports.iter() {
        if let WorldItem::Interface { id, .. } = item {
            insert_type_deps(&resolve, *id, &mut imports);
        }
    }
    for (key, item) in plugin_world.exports.iter() {
        imports.entry(key.clone()).or_insert_with(|| item.clone());
    }
    imports.insert(
        WorldKey::Interface(callstack_iface),
        WorldItem::Interface {
            id: callstack_iface,
            stability: Stability::Unknown,
            span: Default::default(),
        },
    );

    let tracer_pkg = resolve
        .push_str(
            "tracer.wit",
            "package supervisor:tracer;\n\nworld tracer {\n}\n",
        )
        .context("add tracer world package")?;
    let tracer_world_id = *resolve.packages[tracer_pkg]
        .worlds
        .get("tracer")
        .context("tracer world missing")?;

    {
        let world = &mut resolve.worlds[tracer_world_id];
        world.imports = imports;
        world.exports = plugin_world.exports.clone();
    }

    let mut module = trampoline_module(&resolve, tracer_world_id, service)?;
    embed_component_metadata(&mut module, &resolve, tracer_world_id, StringEncoding::UTF8)
        .context("embed tracer component metadata")?;
    ComponentEncoder::default()
        .validate(true)
        .module(&module)
        .context("load tracer core module")?
        .encode()
        .context("encode tracer component")
}

pub(crate) fn can_wrap_with_tracer(plugin_wasm: &[u8]) -> bool {
    let Ok(decoded) = decode(plugin_wasm) else {
        return false;
    };
    let (resolve, world_id) = match decoded {
        wit_component::DecodedWasm::Component(resolve, world) => (resolve, world),
        wit_component::DecodedWasm::WitPackage(_, _) => return false,
    };
    world_has_exported_funcs(&resolve, world_id)
}

fn world_has_exported_funcs(resolve: &Resolve, world_id: WorldId) -> bool {
    let world = &resolve.worlds[world_id];
    world.exports.iter().any(|(_, item)| match item {
        WorldItem::Function(_) => true,
        WorldItem::Interface { id, .. } => !resolve.interfaces[*id].functions.is_empty(),
        WorldItem::Type { .. } => false,
    })
}

struct ResourceFns {
    imported_drop: String,
    exported_new: String,
}

fn insert_type_deps(
    resolve: &Resolve,
    iface: InterfaceId,
    imports: &mut IndexMap<WorldKey, WorldItem>,
) {
    for dep in resolve.interface_direct_deps(iface) {
        insert_type_deps(resolve, dep, imports);
        imports
            .entry(WorldKey::Interface(dep))
            .or_insert(WorldItem::Interface {
                id: dep,
                stability: Stability::Unknown,
                span: Default::default(),
            });
    }
}

fn trampoline_module(resolve: &Resolve, world_id: WorldId, service: &str) -> Result<Vec<u8>> {
    let world = &resolve.worlds[world_id];
    let mut wat = String::new();
    wat.push_str("(module\n");

    let mut import_funcs: IndexMap<(String, String), String> = IndexMap::new();
    let mut next_imp = 0usize;
    let mut resources: HashMap<TypeId, ResourceFns> = HashMap::new();

    for (name, import) in world.imports.iter() {
        match import {
            WorldItem::Function(func) => {
                push_imported_func(
                    &mut wat,
                    resolve,
                    None,
                    func,
                    &mut import_funcs,
                    &mut next_imp,
                );
            }
            WorldItem::Interface { id, .. } => {
                for (_, func) in resolve.interfaces[*id].functions.iter() {
                    push_imported_func(
                        &mut wat,
                        resolve,
                        Some(name),
                        func,
                        &mut import_funcs,
                        &mut next_imp,
                    );
                }
                let also_exported = world.exports.contains_key(name);
                for (_, ty) in resolve.interfaces[*id].types.iter() {
                    push_imported_type_intrinsics(
                        &mut wat,
                        resolve,
                        Some(name),
                        *ty,
                        also_exported,
                        &mut next_imp,
                        &mut resources,
                    );
                }
            }
            WorldItem::Type { id, .. } => {
                push_imported_type_intrinsics(
                    &mut wat,
                    resolve,
                    None,
                    *id,
                    false,
                    &mut next_imp,
                    &mut resources,
                );
            }
        }
    }

    let service_bytes = service.as_bytes();
    // Low memory: watermark stack for re-entrant bump-alloc frames, then the
    // service name. Heap starts after both. Nested JS hops (post-graphql →
    // accounts → host get-sender) share one tracer instance; post_return must
    // restore the caller's heap watermark, not reset to a constant.
    let wm_stack_bytes = 1024u32; // 256 nested frames
    let data_off = wm_stack_bytes;
    let heap_start = align_up(data_off + service_bytes.len() as u32, 16);

    let push_key = callstack_func_key(resolve, world, "push");
    let pop_key = callstack_func_key(resolve, world, "pop");
    let push_local = import_funcs
        .get(&push_key)
        .context("tracer is missing callstack push import")?;
    let pop_local = import_funcs
        .get(&pop_key)
        .context("tracer is missing callstack pop import")?;

    for (name, export) in world.exports.iter() {
        match export {
            WorldItem::Function(func) => {
                push_forwarding_export(
                    &mut wat,
                    resolve,
                    None,
                    func,
                    &import_funcs,
                    &resources,
                    push_local,
                    pop_local,
                    data_off,
                    service_bytes.len() as u32,
                )?;
            }
            WorldItem::Interface { id, .. } => {
                for (_, func) in resolve.interfaces[*id].functions.iter() {
                    push_forwarding_export(
                        &mut wat,
                        resolve,
                        Some(name),
                        func,
                        &import_funcs,
                        &resources,
                        push_local,
                        pop_local,
                        data_off,
                        service_bytes.len() as u32,
                    )?;
                }
                for (_, ty) in resolve.interfaces[*id].types.iter() {
                    push_resource_dtor_export(&mut wat, resolve, name, *ty, &resources)?;
                }
            }
            WorldItem::Type { .. } => {}
        }
    }

    let memory = resolve.wasm_export_name(MANGLING, WasmExport::Memory);
    wat.push_str(&format!("(memory (export {memory:?}) 1)\n"));
    wat.push_str(&format!("(global $heap (mut i32) (i32.const {heap_start}))\n"));
    wat.push_str("(global $wm_sp (mut i32) (i32.const 0))\n");
    wat.push_str(&format!(
        "(data (i32.const {data_off}) \"{}\")\n",
        escape_wat_data(service)
    ));
    wat.push_str(&heap_frame_wat(wm_stack_bytes));

    let realloc = resolve.wasm_export_name(MANGLING, WasmExport::Realloc);
    wat.push_str(&realloc_wat(&realloc));

    let initialize = resolve.wasm_export_name(MANGLING, WasmExport::Initialize);
    wat.push_str(&format!("(func (export {initialize:?}))\n"));
    wat.push_str(")\n");

    wat::parse_str(&wat).with_context(|| format!("parse tracer wat:\n{wat}"))
}

fn callstack_func_key(resolve: &Resolve, world: &World, func: &str) -> (String, String) {
    for (key, item) in world.imports.iter() {
        if let WorldItem::Interface { id, .. } = item {
            if resolve.id_of(*id).as_deref() == Some("supervisor:callstack/callstack") {
                return (resolve.name_world_key(key), func.to_string());
            }
        }
    }
    ("supervisor:callstack/callstack".to_string(), func.to_string())
}

fn push_imported_func(
    wat: &mut String,
    resolve: &Resolve,
    interface: Option<&WorldKey>,
    func: &Function,
    import_funcs: &mut IndexMap<(String, String), String>,
    next_imp: &mut usize,
) {
    let sig = resolve.wasm_signature(MANGLING.import_variant(), func);
    let (module, name) =
        resolve.wasm_import_name(MANGLING, WasmImport::Func { interface, func });
    let local = format!("imp{next_imp}");
    *next_imp += 1;
    let iface_name = interface
        .map(|k| resolve.name_world_key(k))
        .unwrap_or_default();
    import_funcs.insert((iface_name, func.name.clone()), local.clone());

    wat.push_str(&format!(
        "(import {module:?} {name:?} (func ${local}"
    ));
    push_tys(wat, "param", &sig.params);
    push_tys(wat, "result", &sig.results);
    wat.push_str("))\n");
}

fn push_imported_type_intrinsics(
    wat: &mut String,
    resolve: &Resolve,
    interface: Option<&WorldKey>,
    resource: TypeId,
    also_exported: bool,
    next_imp: &mut usize,
    resources: &mut HashMap<TypeId, ResourceFns>,
) {
    let ty = &resolve.types[resource];
    if !matches!(ty.kind, TypeDefKind::Resource) {
        return;
    }
    let drop = resolve.wasm_import_name(
        MANGLING.sync(),
        WasmImport::ResourceIntrinsic {
            interface,
            resource,
            intrinsic: ResourceIntrinsic::ImportedDrop,
        },
    );
    let imported_drop = format!("imp{next_imp}");
    *next_imp += 1;
    wat.push_str(&format!(
        "(import {:?} {:?} (func ${imported_drop} (param i32)))\n",
        drop.0, drop.1
    ));
    if !also_exported {
        return;
    }
    let mut exported_new = String::new();
    for (intrinsic, body) in [
        (ResourceIntrinsic::ExportedDrop, "(param i32)"),
        (
            ResourceIntrinsic::ExportedNew,
            "(param i32) (result i32)",
        ),
        (
            ResourceIntrinsic::ExportedRep,
            "(param i32) (result i32)",
        ),
    ] {
        let is_new = matches!(intrinsic, ResourceIntrinsic::ExportedNew);
        let (module, name) = resolve.wasm_import_name(
            MANGLING.sync(),
            WasmImport::ResourceIntrinsic {
                interface,
                resource,
                intrinsic,
            },
        );
        let local = format!("imp{next_imp}");
        *next_imp += 1;
        wat.push_str(&format!(
            "(import {module:?} {name:?} (func ${local} {body}))\n"
        ));
        if is_new {
            exported_new = local;
        }
    }
    resources.insert(
        resource,
        ResourceFns {
            imported_drop,
            exported_new,
        },
    );
}

fn push_resource_dtor_export(
    wat: &mut String,
    resolve: &Resolve,
    interface: &WorldKey,
    resource: TypeId,
    resources: &HashMap<TypeId, ResourceFns>,
) -> Result<()> {
    let ty = &resolve.types[resource];
    if !matches!(ty.kind, TypeDefKind::Resource) {
        return Ok(());
    }
    let name = resolve.wasm_export_name(
        MANGLING,
        WasmExport::ResourceDtor {
            interface,
            resource,
        },
    );
    // Dtor receives the export-table *rep*, which we stored as the inner
    // plugin's own<T> handle. Drop that imported handle.
    if let Some(fns) = resources.get(&resource) {
        wat.push_str(&format!(
            "(func (export {name:?}) (param i32) (call ${} (local.get 0)))\n",
            fns.imported_drop
        ));
    } else {
        wat.push_str(&format!("(func (export {name:?}) (param i32))\n"));
    }
    Ok(())
}

fn as_handle(resolve: &Resolve, ty: Type) -> Option<(TypeId, bool)> {
    let Type::Id(id) = ty else {
        return None;
    };
    match &resolve.types[id].kind {
        TypeDefKind::Handle(Handle::Own(r)) => Some((*r, true)),
        TypeDefKind::Handle(Handle::Borrow(r)) => Some((*r, false)),
        TypeDefKind::Resource => Some((id, true)),
        TypeDefKind::Type(inner) => as_handle(resolve, *inner),
        _ => None,
    }
}

fn constructor_new_local(
    resolve: &Resolve,
    func: &Function,
    resources: &HashMap<TypeId, ResourceFns>,
) -> Result<Option<String>> {
    if let FunctionKind::Constructor(id) = func.kind {
        return Ok(resources.get(&id).map(|f| f.exported_new.clone()));
    }
    if let Some(ty) = func.result {
        if let Some((id, true)) = as_handle(resolve, ty) {
            if resources.contains_key(&id) {
                bail!(
                    "tracer cannot wrap {}: result is own<resource> on a non-constructor",
                    func.name
                );
            }
        }
    }
    Ok(None)
}

fn check_passthrough_params(
    resolve: &Resolve,
    func: &Function,
    resources: &HashMap<TypeId, ResourceFns>,
) -> Result<()> {
    for (i, param) in func.params.iter().enumerate() {
        let Some((id, _)) = as_handle(resolve, param.ty) else {
            continue;
        };
        if !resources.contains_key(&id) {
            continue;
        }
        let method_self = i == 0
            && matches!(
                func.kind,
                FunctionKind::Method(_) | FunctionKind::AsyncMethod(_)
            );
        if !method_self {
            bail!(
                "tracer cannot wrap {}: resource handle param `{}` is not method-self \
                 (export methods already receive the rep = inner handle)",
                func.name,
                param.name
            );
        }
    }
    Ok(())
}

fn push_forwarding_export(
    wat: &mut String,
    resolve: &Resolve,
    interface: Option<&WorldKey>,
    func: &Function,
    import_funcs: &IndexMap<(String, String), String>,
    resources: &HashMap<TypeId, ResourceFns>,
    push_local: &str,
    pop_local: &str,
    data_off: u32,
    data_len: u32,
) -> Result<()> {
    let import_sig = resolve.wasm_signature(MANGLING.import_variant(), func);
    let export_sig = resolve.wasm_signature(MANGLING.export_variant(), func);
    let name = resolve.wasm_export_name(
        MANGLING,
        WasmExport::Func {
            interface,
            func,
            kind: WasmExportKind::Normal,
        },
    );
    let iface_name = interface
        .map(|k| resolve.name_world_key(k))
        .unwrap_or_default();
    let imp = import_funcs
        .get(&(iface_name.clone(), func.name.clone()))
        .with_context(|| format!("no import for exported {iface_name}/{}", func.name))?;
    check_passthrough_params(resolve, func, resources)?;
    let result_new = constructor_new_local(resolve, func, resources)?;

    wat.push_str(&format!("(func (export {name:?})"));
    push_tys(wat, "param", &export_sig.params);
    push_tys(wat, "result", &export_sig.results);
    for (i, _) in export_sig.results.iter().enumerate() {
        wat.push_str(&format!(" (local $r{i} {})", wasm_ty(export_sig.results[i])));
    }
    wat.push_str(" (local $retptr i32)");
    wat.push_str("\n  (call $heap_push)\n");
    wat.push_str(&format!(
        "  (call ${push_local} (i32.const {data_off}) (i32.const {data_len}))\n"
    ));

    let retptr_bridge = import_sig.retptr
        && export_sig.retptr
        && export_sig.results.len() == 1
        && import_sig.results.is_empty()
        && import_sig.params.len() == export_sig.params.len() + 1;
    let direct = import_sig.params.len() == export_sig.params.len()
        && import_sig.results.len() == export_sig.results.len();

    if retptr_bridge {
        if result_new.is_some() {
            bail!(
                "tracer cannot wrap {}: constructor result used a return pointer",
                func.name
            );
        }
        wat.push_str(
            "  (local.set $retptr (call $realloc (i32.const 0) (i32.const 0) (i32.const 4) (i32.const 256)))\n",
        );
        wat.push_str(&format!("  (call ${imp}"));
        for i in 0..export_sig.params.len() {
            wat.push_str(&format!(" (local.get {i})"));
        }
        wat.push_str(" (local.get $retptr))\n");
        wat.push_str(&format!("  (call ${pop_local})\n"));
        wat.push_str("  (local.get $retptr)\n");
    } else if direct {
        wat.push_str(&format!("  (call ${imp}"));
        for i in 0..export_sig.params.len() {
            wat.push_str(&format!(" (local.get {i})"));
        }
        wat.push_str(")\n");
        for i in (0..export_sig.results.len()).rev() {
            wat.push_str(&format!("  (local.set $r{i})\n"));
        }
        if let Some(new) = &result_new {
            if export_sig.results.len() != 1 {
                bail!(
                    "tracer cannot wrap {}: constructor must return one i32 handle",
                    func.name
                );
            }
            // Inner own<T> handle becomes the export-table rep.
            wat.push_str(&format!(
                "  (local.set $r0 (call ${new} (local.get $r0)))\n"
            ));
        }
        wat.push_str(&format!("  (call ${pop_local})\n"));
        for i in 0..export_sig.results.len() {
            wat.push_str(&format!("  (local.get $r{i})\n"));
        }
    } else {
        bail!(
            "unsupported ABI conversion for {} (import params {:?} results {:?}, export params {:?} results {:?})",
            func.name,
            import_sig.params,
            import_sig.results,
            export_sig.params,
            export_sig.results
        );
    }
    wat.push_str(")\n");

    let post = resolve.wasm_export_name(
        MANGLING,
        WasmExport::Func {
            interface,
            func,
            kind: WasmExportKind::PostReturn,
        },
    );
    wat.push_str(&format!("(func (export {post:?})"));
    push_tys(wat, "param", &export_sig.results);
    // JCO lifts from the retptr before calling post_return; pop the bump
    // frame only after lift so nested re-entry cannot clobber this frame's
    // Result buffer by resetting $heap too early.
    wat.push_str(" (call $heap_pop))\n");
    Ok(())
}

fn heap_frame_wat(wm_stack_bytes: u32) -> String {
    format!(
        r#"
(func $heap_push
  (local $s i32)
  (local.set $s (global.get $wm_sp))
  (if (i32.ge_u (local.get $s) (i32.const {wm_stack_bytes}))
    (then (unreachable)))
  (i32.store (local.get $s) (global.get $heap))
  (global.set $wm_sp (i32.add (local.get $s) (i32.const 4)))
)
(func $heap_pop
  (local $s i32)
  (local.set $s (global.get $wm_sp))
  (if (i32.eqz (local.get $s))
    (then (unreachable)))
  (local.set $s (i32.sub (local.get $s) (i32.const 4)))
  (global.set $wm_sp (local.get $s))
  (global.set $heap (i32.load (local.get $s)))
)
"#
    )
}

fn realloc_wat(export_name: &str) -> String {
    format!(
        r#"
(func $realloc (export {export_name:?}) (param $ptr i32) (param $old i32) (param $align i32) (param $new i32) (result i32)
  (local $h i32) (local $mask i32) (local $needed i32) (local $i i32)
  (if (i32.eqz (local.get $new)) (then (return (i32.const 0))))
  (if (i32.eqz (local.get $align)) (then (local.set $align (i32.const 1))))
  (local.set $mask (i32.sub (local.get $align) (i32.const 1)))
  (local.set $h (global.get $heap))
  (local.set $h (i32.and (i32.add (local.get $h) (local.get $mask)) (i32.xor (local.get $mask) (i32.const -1))))
  (global.set $heap (i32.add (local.get $h) (local.get $new)))
  (local.set $needed (i32.div_u (i32.add (global.get $heap) (i32.const 65535)) (i32.const 65536)))
  (if (i32.gt_u (local.get $needed) (memory.size))
    (then (drop (memory.grow (i32.sub (local.get $needed) (memory.size))))))
  (if (i32.and (i32.ne (local.get $ptr) (i32.const 0)) (i32.gt_u (local.get $old) (i32.const 0)))
    (then
      (local.set $i (i32.const 0))
      (loop $copy
        (if (i32.lt_u (local.get $i) (local.get $old))
          (then
            (if (i32.lt_u (local.get $i) (local.get $new))
              (then (i32.store8 (i32.add (local.get $h) (local.get $i))
                (i32.load8_u (i32.add (local.get $ptr) (local.get $i))))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy))))))
  (local.get $h)
)
"#
    )
}

fn push_tys(dst: &mut String, desc: &str, params: &[WasmType]) {
    if params.is_empty() {
        return;
    }
    dst.push_str(" (");
    dst.push_str(desc);
    for ty in params {
        dst.push(' ');
        dst.push_str(wasm_ty(*ty));
    }
    dst.push(')');
}

fn wasm_ty(ty: WasmType) -> &'static str {
    match ty {
        WasmType::I32 | WasmType::Pointer | WasmType::Length => "i32",
        WasmType::I64 | WasmType::PointerOrI64 => "i64",
        WasmType::F32 => "f32",
        WasmType::F64 => "f64",
    }
}

fn align_up(value: u32, align: u32) -> u32 {
    (value + align - 1) & !(align - 1)
}

fn escape_wat_data(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_graphic() && b != b'\\' && b != b'"' {
                (b as char).to_string()
            } else {
                format!("\\{b:02x}")
            }
        })
        .collect()
}
