use std::collections::HashMap;

use anyhow::anyhow;
use walrus::{FunctionId, FunctionKind, InstrSeqBuilder, LocalFunction, LocalId, Module, ValType};
use walrus::FunctionKind::{Import, Local, Uninitialized};
use walrus::ir::{Instr, InstrSeqId};

// Helper traits
trait TypeFromFid {
    fn func_type(&self, id: FunctionId) -> &walrus::Type;
}

impl TypeFromFid for walrus::Module {
    fn func_type(&self, id : FunctionId) -> &walrus::Type {
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
        || polyfill.funcs.iter_local().any(|(_, local_function)| local_function.size() == 0) 
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
/// * No function bodies
/// * No exports
/// * No function exports
fn should_polyfill(module : &walrus::Module) -> bool {
    if module.types.iter().next().is_none()
        || module.imports.iter().next().is_none()
        || module.funcs.iter().next().is_none()
        || module.funcs.iter_local().all(|f| f.1.size() == 0) 
        || module.exports.iter().next().is_none()
        || !module.funcs.iter().any(|f| module.exports.get_exported_func(f.id()).is_some()) {
        return false;
    }
    true
}

/// Maps imported function IDs in a destination module to their corresponding exported 
/// function IDs from a source module
struct PolyfillTarget {
    source_fid : FunctionId,
    dest_fid : FunctionId,
}

/// Returns a list of `PolyfillTarget` objects.
/// 
/// Only functions that are actually imported in the `dest` module will be considered
/// for polyfilling.
fn get_polyfill_targets(source: &walrus::Module, dest: &walrus::Module) -> Result<Option<Vec<PolyfillTarget>>, anyhow::Error> {

    let mut error : Option<anyhow::Error> = None;
    let targets : Vec<PolyfillTarget> = dest.imports.iter().filter_map(|import| {
        let name = &import.name;

        // Only consider imported functions
        let dest_func = match import.kind {
            walrus::ImportKind::Function(import_fid) => dest.funcs.get(import_fid),
            _ => return None,
        };

        // Check if there's a corresponding export in the `source` module
        let source_func = match source.exports.get_func(name) {
            // This match guard ensures the export function has a local definition
            Ok(exp_fid) if matches!(source.funcs.get(exp_fid).kind, walrus::FunctionKind::Local(_)) => source.funcs.get(exp_fid),
            _ => return None,
        };

        // Check function types match
        if source.func_type(source_func.id()) != dest.func_type(dest_func.id()) {
            error = Some(anyhow!("Destination import {} matches source export by name but not by type.", name));
        }

        Some(PolyfillTarget{
            source_fid: source_func.id(),
            dest_fid: dest_func.id(),
        })
    }).collect();

    if error.is_some() {
        return Err(error.unwrap());
    }

    return Ok(Some(targets));
}

/// Gets the FunctionID if it exists for a function in a `wasm_module` based on a 
/// `function_module` and `name`.
fn get_import_fid(function_module : &str, name : &str, wasm_module : &Module) -> Result<Option<FunctionId>, anyhow::Error> {
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
fn to_dest_func(source_fid : FunctionId, source : &Module, dest : &mut Module ) -> Result<FunctionId, anyhow::Error> {

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
                let (params, results) = (ty.params().to_vec(), ty.results().to_vec());
                let dest_type = dest.types.add(&params, &results);
                dest.add_import_func(module, name, dest_type).0
            }
        },
        Local(_) => {
            let new_local_func = copy_func(source_fid, source, dest)?;
            dest.funcs.add_local(new_local_func)
        },
        Uninitialized(_) => {
            return Err(anyhow!("Error: Source function uninitialized."));
        },
    };
    Ok(new_fid)
}

/// Copies one instruction sequence from a function in a `source` module to a sequence 
/// in a `dest` module.
/// 
/// Returns the id of the new sequence
fn to_dest_seq(source_block_id : InstrSeqId, source_function : &LocalFunction, source : &Module, dest_seq : &mut InstrSeqBuilder, dest : &mut Module, id_maps : &mut IdMaps) -> Result<InstrSeqId, anyhow::Error> {
    // Update the id map with the id of this new sequence. Needed to correctly identify 
    // the corresponding target sequence id for a given source sequence id in a br instruction
    id_maps.seq_id_map.insert(source_block_id, dest_seq.id());

    // Get the instructions from the specified source block
    let instrs = source_function.block(source_block_id).instrs.iter().map(|(instr, _)|{instr});

    let dest_mem_id = dest.get_memory_id()?;

    // Map each source instruction to an instruction injected into the new target sequence
    for instr in instrs {

        match instr {
            // Function reference updates
            Instr::RefFunc(func_ref ) => {
                let mut i = func_ref.clone();
                i.func = to_dest_func(i.func, source, dest)?;
                dest_seq.instr(i);
            }
            Instr::Call(func_ref) => {
                let mut i = func_ref.clone();
                i.func = to_dest_func(i.func, source, dest)?;
                dest_seq.instr(i);
            }
            
            // Sequence reference updates
            Instr::Block(seq_ref) => {
                let mut i = seq_ref.clone();
                let mut new_dest_sequence = dest_seq.dangling_instr_seq(None);
                i.seq = to_dest_seq(i.seq, source_function, source, &mut new_dest_sequence, dest, id_maps)?;
                dest_seq.instr(i);
            }
            Instr::Loop(seq_ref) => {
                let mut i = seq_ref.clone();
                let mut new_dest_sequence = dest_seq.dangling_instr_seq(None);
                i.seq = to_dest_seq( i.seq, source_function, source, &mut new_dest_sequence, dest, id_maps)?;
                dest_seq.instr(i);
            }
            Instr::IfElse(if_else) => {
                let mut i = if_else.clone();
                let mut new_dest_seq_1 = dest_seq.dangling_instr_seq(None);
                i.consequent = to_dest_seq(i.consequent, source_function, source, &mut new_dest_seq_1, dest, id_maps)?;

                let mut new_dest_seq_2 = dest_seq.dangling_instr_seq(None);
                i.alternative = to_dest_seq(i.alternative, source_function, source, &mut new_dest_seq_2, dest, id_maps)?;

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
                i.local = id_maps.to_dest_loc_id(&local_ref.local, source.locals.get(i.local).ty(), dest);
                dest_seq.instr(i);
            }
            Instr::LocalSet(local_ref) => {
                let mut i = local_ref.clone();
                i.local = id_maps.to_dest_loc_id(&local_ref.local, source.locals.get(i.local).ty(), dest);
                dest_seq.instr(i);
            }
            Instr::LocalTee(local_ref) => {
                let mut i = local_ref.clone();
                i.local = id_maps.to_dest_loc_id(&local_ref.local, source.locals.get(i.local).ty(), dest);
                dest_seq.instr(i);
            }

            // Branch sequence id updates
            // "Labels are targets for branch instructions that reference them with label indices. 
            // Unlike with other index spaces, indexing of labels is relative by nesting depth..."
            // https://webassembly.github.io/spec/core/syntax/instructions.html#control-instructions
            Instr::Br(block_ref) => {
                let mut i = block_ref.clone();
                i.block = id_maps.get_mapped_seq(&block_ref.block, "Br instruction references untracked sequence ID")?;
                dest_seq.instr(i);
            }
            Instr::BrIf(block_ref) => {
                let mut i = block_ref.clone();
                i.block = id_maps.get_mapped_seq(&block_ref.block, "BrIf instruction references untracked sequence ID")?;
                dest_seq.instr(i);
            }
            Instr::BrTable(block_table_ref) => {
                let mut i = block_table_ref.clone();
                let mut blocks : Vec<InstrSeqId> = vec![];
                for b in i.blocks.into_vec().iter() {
                    blocks.push(id_maps.get_mapped_seq(&b, "BrTable instruction references untracked sequence ID")?);
                }
                i.blocks = blocks.into();
                i.default = id_maps.get_mapped_seq(&i.default, "BrTable instruction references untracked sequence ID")?;
                dest_seq.instr(i);
            }

            // Invalid instructions
            Instr::CallIndirect(_) => {
                // Polyfill shouldn't be using indirect calls
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: Indirect call"));
            }
            Instr::GlobalGet(_) => {
                // Polyfill shouldn't be referencing globals
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: Get global"));
            }
            Instr::GlobalSet(_) => {
                // Polyfill shouldn't be referencing globals
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: Set global"));
            }
            Instr::MemoryCopy(_) => {
                // Unsure how to handle copying memory
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: Memory copy"));
            }
            Instr::TableGet(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: TableGet"));
            }
            Instr::TableSet(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: TableSet"));
            }
            Instr::TableGrow(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: TableGrow"));
            }
            Instr::TableSize(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: TableSize"));
            }
            Instr::TableFill(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: TableFill"));
            }
            Instr::TableInit(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: TableInit"));
            }
            Instr::TableCopy(_) => {
                // Polyfill not allowed to have a tables section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: TableCopy"));
            }
            Instr::ElemDrop(_) => {
                // Polyfill not allowed to have an elements section
                return Err(anyhow!("Error: Polyfill module has unsupported instruction: ElemDrop"));
            }

            // List every other instruction type, to enforce that new types are properly handled
            Instr::Const(i) => {dest_seq.instr(i.clone());}
            Instr::Binop(i) => {dest_seq.instr(i.clone());}
            Instr::Unop(i) => {dest_seq.instr(i.clone());}
            Instr::Select(i) => {dest_seq.instr(i.clone());}
            Instr::Unreachable(i) => {dest_seq.instr(i.clone());}
            Instr::Drop(i) => {dest_seq.instr(i.clone());}
            Instr::Return(i) => {dest_seq.instr(i.clone());}
            Instr::DataDrop(i) => {dest_seq.instr(i.clone());}
            Instr::AtomicFence(i) => {dest_seq.instr(i.clone());}
            Instr::RefNull(i) => {dest_seq.instr(i.clone());}
            Instr::RefIsNull(i) => {dest_seq.instr(i.clone());}
            Instr::V128Bitselect(i) => {dest_seq.instr(i.clone());}
            Instr::I8x16Swizzle(i) => {dest_seq.instr(i.clone());}
            Instr::I8x16Shuffle(i) => {dest_seq.instr(i.clone());}
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
    seq_id_map : HashMap<InstrSeqId, InstrSeqId>,
    loc_id_map : HashMap<LocalId, LocalId>,
}

impl IdMaps {
    fn get_mapped_seq(&self, seq_id: &InstrSeqId, err : &str) -> Result<InstrSeqId, anyhow::Error> {
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
    fn to_dest_loc_id(&mut self, loc_id: &LocalId, local_type : ValType, dest : &mut Module) -> LocalId {
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
        }
    }
}

/// Copy all instructions from a function in a `source` module to a new function 
/// in a `dest` module.
fn copy_func(source_fid : FunctionId, source : &Module, dest : &mut Module) -> Result<LocalFunction, anyhow::Error>
{
    // Get source local function
    let source_func = source.funcs.get(source_fid);
    let source_local_func = match &source_func.kind {
        walrus::FunctionKind::Local(loc) => loc,
        _ => return Err(anyhow!("Requested local function not found"))
    };

    // Build the new local function in `dest` with the correct signature
    let tid = source_local_func.ty();
    let ty = source.types.get(tid);
    let (params, results) = (ty.params().to_vec(), ty.results().to_vec());

    
    let mut builder = walrus::FunctionBuilder::new(&mut dest.types, &params, &results);
    
    // Make the new local function
    let args = params
        .iter()
        .map(|val_type| dest.locals.add(*val_type))
        .collect::<Vec<_>>();

    // Copy the sequence of instructions in a function from a `source` module into 
    // the new `dest` instruction sequence. 
    let instr_seq_id = source_local_func.entry_block();
    let dest_instr_builder = &mut builder.func_body();
    let mut id_maps: IdMaps = Default::default();

    //Map parameters to locals
    for (index, source_loc_id) in source_local_func.args.iter().enumerate() {
        // Verify the arg type is the same
        let dest_loc_id = args[index];
        if source.locals.get(*source_loc_id).ty() != dest.locals.get(dest_loc_id).ty() {
            return Err(anyhow!("Error mapping locals"));
        }

        id_maps.loc_id_map.insert(*source_loc_id, dest_loc_id);
    }

    to_dest_seq(instr_seq_id, &source_local_func, source, dest_instr_builder, dest, &mut id_maps)?;

    Ok(builder.local_func(args))
}

/// Produce a module that links exported functions in the `source` module to 
/// their corresponding imported functions in a `dest` module.
/// 
/// This also strips out unused functions from the final module.
pub fn link_module(source : &Module, dest : &mut Module) -> Result<(), anyhow::Error> {
    validate_polyfill(&source)?;
    validate_fill_target(dest)?;

    if should_polyfill(dest) {
        if let Some(targets) = get_polyfill_targets(&source, &dest)? 
        {
            for target in targets {
                let PolyfillTarget {source_fid, dest_fid} = target;

                // Get import ID
                let import_id = dest.imports.get_imported_func(dest_fid).map(|i| i.id()).unwrap();
                
                // Copy the function into a new local function in the `dest`
                let new_func = copy_func(source_fid, &source, dest)?;

                // Replace the old imported function with the new local function and delete the old import.
                let dest_func = dest.funcs.get_mut(dest_fid);
                dest_func.kind = FunctionKind::Local(new_func);
                dest.imports.delete(import_id);
            }
        }
    }

    walrus::passes::gc::run(dest);

    // TODO: enable debug builds
    // Prior version of this linker removed all custom sections because it was annoying to 
    // keep them updated while reordering and modifying functions. But now that we are using
    // walrus, dwarf data already in the dest module should be left intact.
    // To support debugging, don't delete the custom sections, might also need to skip binaryen.

    Ok(())
}

#[cfg(test)]
mod tests {
    use core::fmt;
    use std::{fs::{read, File}, io::Write, path::{Path, PathBuf}};
    use anyhow::{Context, Error};
    use wasmparser::Validator;

    use super::*;

    const SERVICE_POLYFILL: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm"));
    const SIMPLE_WASM: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/test-data/simple.wasm");
    const INTERMEDIATE_WASM: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/test-data/intermediate.wasm");

    fn get_dest_module(filepath : &str) -> Result<Module, Error> {
        let filename = &PathBuf::from(filepath);
        let code = &read(filename)
            .with_context(|| format!("Failed to read {}", filename.to_string_lossy()))?;

        let mut config = walrus::ModuleConfig::new();
        config.generate_name_section(false);
        config.generate_producers_section(false);

        Ok(config.parse(code)?)
    }

    fn setup(filepath : &str) -> Result<(Module, Module, Module), Error> {
        // Read wasms from disk into memory
        let mut original = get_dest_module(filepath)?;
        let polyfill = Module::from_buffer(SERVICE_POLYFILL)?;
        let mut filled = get_dest_module(filepath)?;

        // Do the polyfill
        link_module(&polyfill, &mut filled)?;

        // Print both the original and polyfilled wasms in WebAssembly Text (WAT) format
        // Print both the full WAT representation as well as the skeleton representation
        let filled_path = with_suffix(&Path::new(filepath).to_path_buf(), "-filled");
        print_wat(filepath, &original.emit_wasm())?;
        print_wat(filled_path.to_str().unwrap(), &filled.emit_wasm())?;

        Ok((original, polyfill, filled))
    }

    fn new_validator() -> Validator {
        let validator = wasmparser::Validator::new_with_features(wasmparser::WasmFeatures{
            sign_extension: true,
            bulk_memory: true,
            simd: true,
            ..wasmparser::WasmFeatures::default()
        });
        return validator;
    }

    fn wat_path(file_path: &str) -> PathBuf {
        let mut p = Path::new(file_path).to_path_buf();
        p.set_extension("wat");
        p
    }

    fn with_suffix(file_path : &PathBuf, suffix : &str) -> PathBuf {
        let stem = file_path.file_stem().unwrap_or_default().to_str().unwrap_or("");
        let extension = file_path.extension().map_or_else(|| "", |e| e.to_str().unwrap_or(""));
        let new_stem = format!("{}{}", stem, suffix);

        file_path.with_file_name(new_stem).with_extension(extension)
    }

    fn print_wat(wasm_path: &str, wasm_data : &Vec<u8> ) -> Result<(), Error> {
        let wat_path = wat_path(wasm_path);
        let skele_path = with_suffix(&wat_path, "-skeleton");

        let mut printer = wasmprinter::Printer::new();
        let wat_data = printer.print(wasm_data)?;
        printer.print_skeleton(true);
        let wat_skele = printer.print(wasm_data)?;

        File::create(&wat_path)?.write_all((&wat_data).as_bytes())?;
        File::create(&skele_path)?.write_all((&wat_skele).as_bytes())?;
        Ok(())
    }

    struct ImportFunction {
        _id : FunctionId,
        name : String,
        module : String,
    }
    impl fmt::Display for ImportFunction {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            write!(f, "{}::{}", self.module, self.name)
        }
    }

    fn get_import_funcs(module : &Module) -> Vec<ImportFunction> {
        module.imports.iter().filter_map(|import| {
            let dest_func = match import.kind {
                walrus::ImportKind::Function(import_fid) => module.funcs.get(import_fid),
                _ => return None,
            };
            
            let import = module.imports.get_imported_func(dest_func.id()).unwrap();
            

            Some(ImportFunction {
                    _id : dest_func.id(),
                    name: import.name.to_owned(),
                    module: import.module.to_owned()
                }
            )
        }).collect()
    }

    #[test]
    fn imports_removed() -> Result<(), Error> {
        let (original, polyfill, filled) = setup(SIMPLE_WASM)?;

        let targets_before_fill: Option<Vec<PolyfillTarget>> = get_polyfill_targets(&polyfill, &original)?;
        let _import_fids : Vec<FunctionId> = if let Some(targets) = targets_before_fill {
            assert_eq!(targets.len(), 4, "Before fill, polyfill targets should be 4.");
            targets.into_iter().map(|t| t.dest_fid).collect()
        } else {
            vec![]
        };

        let targets_after_fill: Option<Vec<PolyfillTarget>> = get_polyfill_targets(&polyfill, &filled)?;
        if let Some(targets) = targets_after_fill {
            assert_eq!(targets.len(), 0, "After fill, polyfill targets should be 0.");
        }

        let import_funcs = get_import_funcs(&filled);
        for f in import_funcs {
            println!("{}", f);
        }

        Ok(())
    }

    #[test]
    fn valid_wasm_produced_1() -> Result<(), Error> {
        let (mut original, _, mut filled) = setup(SIMPLE_WASM)?;

        new_validator().validate_all(&original.emit_wasm()).map_err(|e|anyhow!("[simple.wasm] {}", e))?;
        new_validator().validate_all(&filled.emit_wasm()).map_err(|e|anyhow!("[simple.filled.wasm] {}", e))?;
        Ok(())
    }

    #[test]
    fn valid_wasm_produced_2() -> Result<(), Error> {
        let (mut original, _, mut filled) = setup(INTERMEDIATE_WASM)?;

        new_validator().validate_all(&original.emit_wasm()).map_err(|e|anyhow!("[intermediate.wasm] {}", e))?;
        new_validator().validate_all(&filled.emit_wasm()).map_err(|e|anyhow!("[intermediate.filled.wasm] {}", e))?;
        Ok(())
    }
}