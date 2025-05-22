use std::collections::HashMap;

use anyhow::anyhow;
use walrus::ir::{Instr, InstrSeqId};
use walrus::FunctionKind::{Import, Local, Uninitialized};
use walrus::{FunctionId, FunctionKind, InstrSeqBuilder, LocalFunction, LocalId, Module, ValType};
use wasmparser::Validator;

// Helper traits
trait TypeFromFid {
    fn func_type(&self, id: FunctionId) -> &walrus::Type;
}

impl TypeFromFid for walrus::Module {
    fn func_type(&self, id: FunctionId) -> &walrus::Type {
        &self.types.get(self.funcs.get(id).ty())
    }
}

/// The polyfill module must not have the following sections, since they require
/// relocatable wasms to merge:
/// * Tables
/// * Start
/// * Elements
/// * Data
///
/// The polyfill must include the following sections:
/// * Types
/// * Imports
/// * Functions
/// * Exports
///
/// Any local functions in the polyfill must have >0 instructions
fn validate_polyfill(polyfill: &walrus::Module) -> Result<(), anyhow::Error> {
    if polyfill.tables.iter().next().is_some()
        || polyfill.start.is_some()
        || polyfill.elements.iter().next().is_some()
        || polyfill.data.iter().next().is_some()
    {
        // Rust uses lld, which currently errors out when attempting to
        // produce relocatable wasms. If it could produce relocatable wasms,
        // there is an alternative solution to writing this custom
        // linker: feed lld's output, along with the polyfill, back
        // into lld, after repairing names which unfortunately vary
        // over time, e.g.
        // "$_ZN4wasi13lib_generated22wasi_snapshot_preview18fd_write17haadc9440e6dddc5cE"
        //
        // Another option that we may try in the future: rustc doesn't
        // give us enough control over library link order to insert
        // polyfills into the right spot. We could create a linker wrapper
        // which invokes lld after doing the name translation, giving
        // us that control. We'd still have to remove unused functions
        // after link, since neither lld nor binaryen currently do that.
        // wasm-gc does it, but its repo is archived.
        return Err(anyhow!("Polyfill has unexpected section"));
    }
    if polyfill.types.iter().next().is_none()
        || polyfill.imports.iter().next().is_none()
        || polyfill.funcs.iter().next().is_none()
        || polyfill
            .funcs
            .iter_local()
            .any(|(_, local_function)| local_function.size() == 0)
        || polyfill.exports.iter().next().is_none()
    {
        return Err(anyhow!("Polyfill has missing section"));
    }

    Ok(())
}

/// The module is not a supported target for polyfilling if it has the following:
/// * A start function
fn validate_fill_target(module: &walrus::Module) -> Result<(), anyhow::Error> {
    if module.start.is_some() {
        return Err(anyhow!("Target module has unsupported section: start"))?;
    }
    Ok(())
}

/// A module is not a candidate for polyfilling if it has any of the following:
/// * No types
/// * No imports
/// * No functions
/// * No exports
/// * No function exports
fn should_polyfill(module: &walrus::Module) -> bool {
    if module.types.iter().next().is_none()
        || module.imports.iter().next().is_none()
        || module.funcs.iter().next().is_none()
        || module.exports.iter().next().is_none()
        || !module
            .funcs
            .iter()
            .any(|f| module.exports.get_exported_func(f.id()).is_some())
    {
        return false;
    }
    true
}

/// Maps imported function IDs in a destination module to their corresponding exported
/// function IDs from a source module
struct PolyfillTarget {
    source_fid: FunctionId,
    dest_fid: FunctionId,
}

/// Returns a list of `PolyfillTarget` objects.
///
/// Only functions that are actually imported in the `dest` module will be considered
/// for polyfilling.
fn get_polyfill_targets(
    source: &walrus::Module,
    dest: &walrus::Module,
) -> Result<Option<Vec<PolyfillTarget>>, anyhow::Error> {
    let mut error: Option<anyhow::Error> = None;
    let targets: Vec<PolyfillTarget> = dest
        .imports
        .iter()
        .filter_map(|import| {
            let name = &import.name;

            // Only consider imported functions
            let dest_func = match import.kind {
                walrus::ImportKind::Function(import_fid) => dest.funcs.get(import_fid),
                _ => return None,
            };

            // Check if there's a corresponding export in the `source` module
            let source_func = match source.exports.get_func(name) {
                Ok(exp_fid) => source.funcs.get(exp_fid),
                _ => return None,
            };

            // Check function types match
            if source.func_type(source_func.id()) != dest.func_type(dest_func.id()) {
                error = Some(anyhow!(
                    "Destination import {} matches source export by name but not by type.",
                    name
                ));
            }

            Some(PolyfillTarget {
                source_fid: source_func.id(),
                dest_fid: dest_func.id(),
            })
        })
        .collect();

    if error.is_some() {
        return Err(error.unwrap());
    }

    return Ok(Some(targets));
}

/// Gets the FunctionID if it exists for a function in a `wasm_module` based on a
/// `function_module` and `name`.
fn get_import_fid(
    function_module: &str,
    name: &str,
    wasm_module: &Module,
) -> Result<Option<FunctionId>, anyhow::Error> {
    wasm_module
        .imports
        .iter()
        .find(|&i| &i.name == name && &i.module == function_module)
        .map_or(Ok(None), |i| match i.kind {
            walrus::ImportKind::Function(fid) => Ok(Some(fid)),
            _ => Err(anyhow!("Import kind mismatch")),
        })
}

/// Get the corresponding FunctionID in the `dest` module for a given FunctionID from the `source`
/// module. If the function does not exist in the `dest` module, it will be added.
fn to_dest_func(
    source_fid: FunctionId,
    source: &Module,
    dest: &mut Module,
    id_maps: &mut IdMaps,
) -> Result<FunctionId, anyhow::Error> {
    let f = source.funcs.get(source_fid);
    let (source_func_kind, source_func_ty) = (&f.kind, f.ty());

    let new_fid = match &source_func_kind {
        Import(_) => {
            let s = source.imports.get_imported_func(source_fid).unwrap();
            let (module, name) = (&s.module, &s.name);

            let dest_fid_opt = get_import_fid(module, name, &dest)?;

            if let Some(dest_fid) = dest_fid_opt {
                // The import already exists in the dest
                if dest.func_type(dest_fid) != source.func_type(source_fid) {
                    return Err(anyhow!("Type mismatch between imports"));
                }
                dest_fid
            } else {
                // The import needs to be added to the dest. Update the called fid.
                let ty = source.types.get(source_func_ty);
                let dest_type = dest.types.add(ty.params(), ty.results());
                dest.add_import_func(module, name, dest_type).0
            }
        }
        Local(loc) => {
            if let Some(local_fid) = id_maps.loc_fid_map.get(&source_fid) {
                *local_fid
            } else {
                let new_local_func = copy_func(loc, &f.name, source, dest, id_maps)?;
                let new_local_fid = dest.funcs.add_local(new_local_func);
                id_maps.loc_fid_map.insert(source_fid, new_local_fid);
                new_local_fid
            }
        }
        Uninitialized(_) => {
            return Err(anyhow!("Error: Source function uninitialized."));
        }
    };
    Ok(new_fid)
}

/// Copies one instruction sequence from a function in a `source` module to a sequence
/// in a `dest` module.
///
/// Returns the id of the new sequence
fn to_dest_seq(
    source_block_id: InstrSeqId,
    source_function: &LocalFunction,
    source: &Module,
    dest_seq: &mut InstrSeqBuilder,
    dest: &mut Module,
    id_maps: &mut IdMaps,
) -> Result<InstrSeqId, anyhow::Error> {
    // Update the id map with the id of this new sequence. Needed to correctly identify
    // the corresponding target sequence id for a given source sequence id in a br instruction
    id_maps.seq_id_map.insert(source_block_id, dest_seq.id());

    // Get the instructions from the specified source block
    let instrs = source_function
        .block(source_block_id)
        .instrs
        .iter()
        .map(|(instr, _)| instr);

    let dest_mem_id = dest.get_memory_id()?;

    // Map each source instruction to an instruction injected into the new target sequence
    for instr in instrs {
        match instr {
            // Function reference updates
            Instr::RefFunc(func_ref) => {
                let mut i = func_ref.clone();
                i.func = to_dest_func(i.func, source, dest, id_maps)?;
                dest_seq.instr(i);
            }
            Instr::Call(func_ref) => {
                let mut i = func_ref.clone();
                i.func = to_dest_func(i.func, source, dest, id_maps)?;
                dest_seq.instr(i);
            }

            // Sequence reference updates
            Instr::Block(seq_ref) => {
                let mut i = seq_ref.clone();
                let mut new_dest_sequence =
                    dest_seq.dangling_instr_seq(source_function.block(i.seq).ty);
                i.seq = to_dest_seq(
                    i.seq,
                    source_function,
                    source,
                    &mut new_dest_sequence,
                    dest,
                    id_maps,
                )?;
                dest_seq.instr(i);
            }
            Instr::Loop(seq_ref) => {
                let mut i = seq_ref.clone();
                let mut new_dest_sequence =
                    dest_seq.dangling_instr_seq(source_function.block(i.seq).ty);
                i.seq = to_dest_seq(
                    i.seq,
                    source_function,
                    source,
                    &mut new_dest_sequence,
                    dest,
                    id_maps,
                )?;
                dest_seq.instr(i);
            }
            Instr::IfElse(if_else) => {
                let mut i = if_else.clone();

                let mut new_dest_seq_1 =
                    dest_seq.dangling_instr_seq(source_function.block(i.consequent).ty);
                i.consequent = to_dest_seq(
                    i.consequent,
                    source_function,
                    source,
                    &mut new_dest_seq_1,
                    dest,
                    id_maps,
                )?;

                let mut new_dest_seq_2 =
                    dest_seq.dangling_instr_seq(source_function.block(i.alternative).ty);
                i.alternative = to_dest_seq(
                    i.alternative,
                    source_function,
                    source,
                    &mut new_dest_seq_2,
                    dest,
                    id_maps,
                )?;

                dest_seq.instr(i);
            }

            // Memory reference updates
            Instr::MemorySize(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::MemoryGrow(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::MemoryInit(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::MemoryFill(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::Load(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::Store(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::AtomicRmw(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::Cmpxchg(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::AtomicNotify(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::AtomicWait(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }
            Instr::LoadSimd(mem_ref) => {
                let mut i = mem_ref.clone();
                i.memory = dest_mem_id;
                dest_seq.instr(i);
            }

            // Local reference updates
            Instr::LocalGet(local_ref) => {
                let mut i = local_ref.clone();
                i.local =
                    id_maps.to_dest_loc_id(&local_ref.local, source.locals.get(i.local).ty(), dest);
                dest_seq.instr(i);
            }
            Instr::LocalSet(local_ref) => {
                let mut i = local_ref.clone();
                i.local =
                    id_maps.to_dest_loc_id(&local_ref.local, source.locals.get(i.local).ty(), dest);
                dest_seq.instr(i);
            }
            Instr::LocalTee(local_ref) => {
                let mut i = local_ref.clone();
                i.local =
                    id_maps.to_dest_loc_id(&local_ref.local, source.locals.get(i.local).ty(), dest);
                dest_seq.instr(i);
            }

            // Branch sequence id updates
            // "Labels are targets for branch instructions that reference them with label indices.
            // Unlike with other index spaces, indexing of labels is relative by nesting depth..."
            // https://webassembly.github.io/spec/core/syntax/instructions.html#control-instructions
            Instr::Br(block_ref) => {
                let mut i = block_ref.clone();
                i.block = id_maps.get_mapped_seq(
                    &block_ref.block,
                    "`br` instruction references untracked sequence ID",
                )?;
                dest_seq.instr(i);
            }
            Instr::BrIf(block_ref) => {
                let mut i = block_ref.clone();
                i.block = id_maps.get_mapped_seq(
                    &block_ref.block,
                    "`br_if` instruction references untracked sequence ID",
                )?;
                dest_seq.instr(i);
            }
            Instr::BrTable(block_table_ref) => {
                let mut i = block_table_ref.clone();
                let mut blocks: Vec<InstrSeqId> = vec![];
                for b in i.blocks.into_vec().iter() {
                    blocks.push(id_maps.get_mapped_seq(
                        &b,
                        "`br_table` instruction references untracked sequence ID",
                    )?);
                }
                i.blocks = blocks.into();
                i.default = id_maps.get_mapped_seq(
                    &i.default,
                    "`br_table` instruction references untracked sequence ID",
                )?;
                dest_seq.instr(i);
            }

            // Invalid instructions
            Instr::CallIndirect(_) => {
                // Polyfill shouldn't be using indirect calls
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `call_indirect`"
                ));
            }
            Instr::GlobalGet(_) => {
                // Polyfill shouldn't be referencing globals
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `global.get`"
                ));
            }
            Instr::GlobalSet(_) => {
                // Polyfill shouldn't be referencing globals
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `global.set`"
                ));
            }
            Instr::MemoryCopy(_) => {
                // Unsure how to handle copying memory
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `memory.copy`"
                ));
            }
            Instr::TableGet(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `table.get`"
                ));
            }
            Instr::TableSet(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `table.set`"
                ));
            }
            Instr::TableGrow(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `table.grow`"
                ));
            }
            Instr::TableSize(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `table.size`"
                ));
            }
            Instr::TableFill(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `table.fill`"
                ));
            }
            Instr::TableInit(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `table.init`"
                ));
            }
            Instr::TableCopy(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `table.copy`"
                ));
            }
            Instr::ElemDrop(_) => {
                // Polyfill not allowed to have an elements section
                return Err(anyhow!(
                    "Error: Polyfill module has unsupported instruction: `elem.drop`"
                ));
            }

            // List every other instruction type, to enforce that new types are properly handled
            Instr::Const(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::Binop(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::Unop(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::Select(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::Unreachable(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::Drop(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::Return(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::DataDrop(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::AtomicFence(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::RefNull(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::RefIsNull(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::V128Bitselect(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::I8x16Swizzle(i) => {
                dest_seq.instr(i.clone());
            }
            Instr::I8x16Shuffle(i) => {
                dest_seq.instr(i.clone());
            }
        }
    }

    Ok(dest_seq.id())
}

/// Tracks the ids from a source wasm and their corresponding new id
/// created in the destination wasm.
///
/// Needed to ensure that various instructions in the destination are
/// consistently referencing the correct ids.
struct IdMaps {
    seq_id_map: HashMap<InstrSeqId, InstrSeqId>,
    loc_id_map: HashMap<LocalId, LocalId>,
    loc_fid_map: HashMap<FunctionId, FunctionId>,
}

impl IdMaps {
    fn get_mapped_seq(&self, seq_id: &InstrSeqId, err: &str) -> Result<InstrSeqId, anyhow::Error> {
        if let Some(id) = self.seq_id_map.get(seq_id) {
            return Ok(*id);
        } else {
            return Err(anyhow!(err.to_owned()));
        }
    }

    // Creates a new local in the dest module if this is the first time
    // we have seen the specified local from the source module `loc_id`.
    // If we have already seen a reference to this source local, then we
    // replace the reference to the corresponding (already created) target local.
    fn to_dest_loc_id(
        &mut self,
        loc_id: &LocalId,
        local_type: ValType,
        dest: &mut Module,
    ) -> LocalId {
        if let Some(local_id) = self.loc_id_map.get(loc_id) {
            return *local_id;
        } else {
            let new_local = dest.locals.add(local_type);
            self.loc_id_map.insert(*loc_id, new_local);
            return new_local;
        }
    }
}

impl Default for IdMaps {
    fn default() -> Self {
        IdMaps {
            seq_id_map: HashMap::new(),
            loc_id_map: HashMap::new(),
            loc_fid_map: HashMap::new(),
        }
    }
}

/// Copy all instructions from a function in a `source` module to a new function
/// in a `dest` module.
fn copy_func(
    source_local_func: &LocalFunction,
    source_local_func_name: &Option<String>,
    source: &Module,
    dest: &mut Module,
    id_maps: &mut IdMaps,
) -> Result<LocalFunction, anyhow::Error> {
    // Build the new local function in `dest` with the correct signature
    let tid = source_local_func.ty();
    let ty = source.types.get(tid);
    let (params, results) = (ty.params().to_vec(), ty.results().to_vec());

    let mut builder = walrus::FunctionBuilder::new(&mut dest.types, &params, &results);

    if source_local_func_name.is_some() {
        builder.name(source_local_func_name.to_owned().unwrap());
    }

    // Make the new local function
    let args = params
        .iter()
        .map(|val_type| dest.locals.add(*val_type))
        .collect::<Vec<_>>();

    // Copy the sequence of instructions in a function from a `source` module into
    // the new `dest` instruction sequence.
    let instr_seq_id = source_local_func.entry_block();
    let dest_instr_builder = &mut builder.func_body();

    // Map parameters to locals
    for (index, source_loc_id) in source_local_func.args.iter().enumerate() {
        // Verify the arg type is the same
        let dest_loc_id = args[index];
        if source.locals.get(*source_loc_id).ty() != dest.locals.get(dest_loc_id).ty() {
            return Err(anyhow!("Error mapping locals"));
        }

        id_maps.loc_id_map.insert(*source_loc_id, dest_loc_id);
    }

    to_dest_seq(
        instr_seq_id,
        &source_local_func,
        source,
        dest_instr_builder,
        dest,
        id_maps,
    )?;

    Ok(builder.local_func(args))
}

fn new_validator() -> Validator {
    let validator = wasmparser::Validator::new_with_features(wasmparser::WasmFeatures {
        sign_extension: true,
        bulk_memory: true,
        simd: true,
        saturating_float_to_int: true,
        ..wasmparser::WasmFeatures::default()
    });
    return validator;
}

/// Produce a module that links exported functions in the `source` module to
/// their corresponding imported functions in a `dest` module.
///
/// This also strips out unused functions from the final module.
pub fn link_module(source: &Module, dest: &mut Module) -> Result<(), anyhow::Error> {
    validate_polyfill(&source)?;
    validate_fill_target(dest)?;

    let mut id_maps: IdMaps = Default::default();
    if should_polyfill(dest) {
        if let Some(targets) = get_polyfill_targets(&source, &dest)? {
            for target in targets {
                let PolyfillTarget {
                    source_fid,
                    dest_fid,
                } = target;

                // Get import ID
                let import_id = dest
                    .imports
                    .get_imported_func(dest_fid)
                    .map(|i| i.id())
                    .unwrap();

                // Get source local function
                let source_func = source.funcs.get(source_fid);
                match &source_func.kind {
                    walrus::FunctionKind::Local(loc) => {
                        // Copy the function into a new local function in the `dest`
                        let new_func =
                            copy_func(loc, &source_func.name, &source, dest, &mut id_maps)?;

                        // Replace the old imported function with the new local function and delete the old import.
                        let dest_func = dest.funcs.get_mut(dest_fid);
                        dest_func.kind = FunctionKind::Local(new_func);
                        dest.imports.delete(import_id);
                    }
                    walrus::FunctionKind::Import(_) => {
                        // Rewrite the dest import to the source import
                        let source_import = source.imports.get_imported_func(source_fid).unwrap();
                        let dest_import = dest.imports.get_mut(import_id);
                        dest_import.module = source_import.module.to_owned();
                        dest_import.name = source_import.name.to_owned();
                    }
                    _ => return Err(anyhow!("Requested local function not found")),
                }
            }
        }
    }

    walrus::passes::gc::run(dest);

    // To be safe, run the validator on every wasm produced by this linker
    new_validator()
        .validate_all(&dest.emit_wasm())
        .map_err(|e| anyhow!("[Wasm linker error] {}", e))?;

    // TODO: enable debug builds
    // Prior version of this linker removed all custom sections because it was annoying to
    // keep them updated while reordering and modifying functions. But now that we are using
    // walrus, dwarf data already in the dest module should be left intact.
    // To support debugging, don't delete the custom sections, might also need to skip wasm-opt.

    Ok(())
}

#[cfg(test)]
mod tests {
    use anyhow::Error;
    use core::fmt;
    use std::{
        fs::File,
        io::Write,
        path::{Path, PathBuf},
    };

    use super::*;

    const SERVICE_POLYFILL: &str = concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm");
    const CARGO_MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

    // Config params
    const GEN_NAME_SECTION: bool = false;
    const GEN_PRODUCERS_SECTION: bool = false;
    const PRINT_OFFSETS: bool = false;

    fn rel_to_manifest(filepath: &str) -> String {
        format!("{}{}", CARGO_MANIFEST_DIR, filepath)
    }

    fn walrus_config() -> walrus::ModuleConfig {
        let mut config = walrus::ModuleConfig::new();
        config.generate_name_section(GEN_NAME_SECTION);
        config.generate_producers_section(GEN_PRODUCERS_SECTION);
        config
    }

    fn wasm(filepath: &str) -> Result<Module, Error> {
        walrus_config().parse_file(filepath)
    }

    fn wat(filepath: &str) -> Result<Module, Error> {
        walrus_config().parse(&wat::parse_file(filepath)?)
    }

    fn wat_path(file_path: &str) -> PathBuf {
        let mut p = Path::new(file_path).to_path_buf();
        p.set_extension("wat");
        p
    }

    fn suffix_pb(file_path: &PathBuf, suffix: &str) -> PathBuf {
        let stem = file_path
            .file_stem()
            .unwrap_or_default()
            .to_str()
            .unwrap_or("");
        let extension = file_path
            .extension()
            .map_or_else(|| "", |e| e.to_str().unwrap_or(""));
        let new_stem = format!("{}{}", stem, suffix);

        file_path.with_file_name(new_stem).with_extension(extension)
    }

    fn suffix(filepath: &str, suffix: &str) -> String {
        let filepath_pb = &Path::new(filepath).to_path_buf();
        suffix_pb(filepath_pb, suffix).to_str().unwrap().to_string()
    }

    fn print_wat(wasm_path: &str, wasm_data: &Vec<u8>) -> Result<(), Error> {
        let wat_path = wat_path(wasm_path);
        let skele_path = suffix_pb(&wat_path, "-skeleton");

        let mut printer = wasmprinter::Printer::new();
        printer.print_offsets(PRINT_OFFSETS);
        let wat_data = printer.print(wasm_data)?;
        printer.print_skeleton(true);
        let wat_skele = printer.print(wasm_data)?;

        File::create(&wat_path)?.write_all((&wat_data).as_bytes())?;
        File::create(&skele_path)?.write_all((&wat_skele).as_bytes())?;
        Ok(())
    }

    struct ImportFunction {
        _id: FunctionId,
        name: String,
        module: String,
    }
    impl fmt::Display for ImportFunction {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            write!(f, "{}::{}", self.module, self.name)
        }
    }

    fn get_import_funcs(module: &Module) -> Vec<ImportFunction> {
        module
            .imports
            .iter()
            .filter_map(|import| {
                let dest_func = match import.kind {
                    walrus::ImportKind::Function(import_fid) => module.funcs.get(import_fid),
                    _ => return None,
                };

                let import = module.imports.get_imported_func(dest_func.id()).unwrap();

                Some(ImportFunction {
                    _id: dest_func.id(),
                    name: import.name.to_owned(),
                    module: import.module.to_owned(),
                })
            })
            .collect()
    }

    #[test]
    fn imports_removed() -> Result<(), Error> {
        let simple_wasm = &rel_to_manifest("/test-data/simple.wasm");
        let mut original = wasm(simple_wasm)?;
        let mut destination = wasm(simple_wasm)?;
        let polyfill = wasm(SERVICE_POLYFILL)?;

        link_module(&polyfill, &mut destination)?;

        print_wat(simple_wasm, &original.emit_wasm())?;
        print_wat(&suffix(simple_wasm, "-filled"), &destination.emit_wasm())?;

        let targets_before_fill: Option<Vec<PolyfillTarget>> =
            get_polyfill_targets(&polyfill, &original)?;
        let _import_fids: Vec<FunctionId> = if let Some(targets) = targets_before_fill {
            assert_eq!(
                targets.len(),
                4,
                "Before fill, polyfill targets should be 4."
            );
            targets.into_iter().map(|t| t.dest_fid).collect()
        } else {
            vec![]
        };

        let targets_after_fill: Option<Vec<PolyfillTarget>> =
            get_polyfill_targets(&polyfill, &destination)?;
        if let Some(targets) = targets_after_fill {
            assert_eq!(
                targets.len(),
                0,
                "After fill, polyfill targets should be 0."
            );
        }

        let import_funcs = get_import_funcs(&destination);
        for f in import_funcs {
            println!("{}", f);
        }

        Ok(())
    }

    #[test]
    fn fill_reexport() -> Result<(), Error> {
        let import_path = &rel_to_manifest("/test-data/import.wat");
        let mut destination = wat(import_path)?;
        let mut polyfill = wat(&rel_to_manifest("/test-data/reexport.wat"))?;

        new_validator()
            .validate_all(&destination.emit_wasm())
            .map_err(|e| anyhow!("[import.wat not valid] {}", e))?;
        new_validator()
            .validate_all(&polyfill.emit_wasm())
            .map_err(|e| anyhow!("[reexport.wat not valid] {}", e))?;

        let imports = get_import_funcs(&destination);
        assert!(imports.len() == 1, "Unexpected import");
        assert!(
            imports[0].module == "wasi_snapshot_preview1",
            "Prefill import module incorrect"
        );
        assert!(
            imports[0].name == "fd_close",
            "Prefill import name incorrect"
        );

        link_module(&polyfill, &mut destination)?;
        print_wat(&suffix(import_path, "-filled"), &destination.emit_wasm())?;

        let post_imports = get_import_funcs(&destination);
        assert!(post_imports.len() == 1, "Unexpected import");
        assert!(
            post_imports[0].module == "env",
            "Postfill import module incorrect"
        );
        assert!(
            post_imports[0].name == "testerClose",
            "Postfill import name incorrect"
        );

        Ok(())
    }
}
