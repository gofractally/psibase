// The chain's wasm limits (gofractally/psibase#2262): every member of
// VMOptions is enforced by admission and has a hard ceiling. Included at the
// end of PsizamTests.cpp for its fixtures; the cases are tagged [limits] and
// registered as a ctest of their own (VmLimitsTests), because modules at the
// ceilings take seconds to build and compile.
//
// The modules are built here; nothing is checked in.

namespace
{
   using Bytes = std::vector<std::uint8_t>;

   void append(Bytes& out, const Bytes& more)
   {
      out.insert(out.end(), more.begin(), more.end());
   }
   Bytes lebBytes(std::uint32_t value)
   {
      Bytes result;
      leb(result, value);
      return result;
   }
   Bytes repeated(std::uint32_t count, const Bytes& item)
   {
      Bytes result;
      result.reserve(std::size_t(count) * item.size());
      for (std::uint32_t i = 0; i < count; ++i)
         append(result, item);
      return result;
   }
   Bytes nameBytes(std::string_view text)
   {
      Bytes result = lebBytes(text.size());
      result.insert(result.end(), text.begin(), text.end());
      return result;
   }

   // A service module: `start` (function 0) and `called` (function 1), plus
   // whatever a probe adds. Types 0 and 1 are the entry points' and type 2
   // is () -> (). `called` runs `calledBody` (instructions, without the
   // final end), so executing the service executes the probe.
   struct ServiceModule
   {
      struct Type
      {
         Bytes params, results;
      };
      struct Function
      {
         std::uint32_t type;
         Bytes         body;  // locals declarations and instructions, with the end
      };
      std::vector<Type>     types{{{0x7e}, {}}, {{0x7e, 0x7e}, {}}, {{}, {}}};
      std::uint32_t         fillerTypes = 0;  // more copies of () -> ()
      std::uint32_t         imports     = 0;  // of the first host function
      std::vector<Function> functions;        // after start and called
      std::uint32_t         fillerFunctions = 0;  // () -> (), empty
      std::vector<std::uint32_t> tables;          // initial sizes
      Bytes                      tableType{0x70};  // the element type of each
      std::vector<std::uint32_t> memories;        // initial pages
      Bytes                      globals;         // entries, encoded
      std::uint32_t              globalCount = 0;
      Bytes                      exports;  // entries after start and called, encoded
      std::uint32_t              exportCount = 0;
      Bytes                      elements;  // segments, encoded
      std::uint32_t              elementCount = 0;
      Bytes                      data;  // segments, encoded
      std::uint32_t              dataCount = 0;
      std::vector<std::string>   customs;  // names of custom sections
      Bytes                      calledBody;
      // Pads the module to this size with a custom section, if not 0.
      std::size_t size = 0;

      std::uint32_t addType(Bytes params, Bytes results)
      {
         types.push_back({std::move(params), std::move(results)});
         return types.size() - 1;
      }
      // The index of the function, as `call` needs it.
      std::uint32_t addFunction(std::uint32_t type, Bytes body)
      {
         functions.push_back({type, std::move(body)});
         return imports + 2 + functions.size() - 1;
      }
      void addExport(std::string_view name, std::uint8_t kind, std::uint32_t index)
      {
         append(exports, nameBytes(name));
         exports.push_back(kind);
         leb(exports, index);
         ++exportCount;
      }

      Bytes build() const
      {
         Bytes code{0, 'a', 's', 'm', 1, 0, 0, 0};
         Bytes body;
         auto  emit = [&](std::uint8_t id)
         {
            section(code, id, body);
            body.clear();
         };
         // Importing a host function more than once is allowed. Its type
         // goes last so that no index above moves.
         const auto& host = psibase::nativeHostFunctions().front();
         leb(body, types.size() + fillerTypes + (imports ? 1 : 0));
         for (const auto& type : types)
         {
            body.push_back(0x60);
            leb(body, type.params.size());
            append(body, type.params);
            leb(body, type.results.size());
            append(body, type.results);
         }
         append(body, repeated(fillerTypes, {0x60, 0, 0}));
         if (imports)
         {
            body.push_back(0x60);
            leb(body, host.params.size());
            append(body, host.params);
            leb(body, host.results.size());
            append(body, host.results);
         }
         emit(1);
         if (imports)
         {
            leb(body, imports);
            Bytes entry = nameBytes(host.module);
            append(entry, nameBytes(host.name));
            entry.push_back(0);
            leb(entry, types.size() + fillerTypes);
            append(body, repeated(imports, entry));
            emit(2);
         }
         leb(body, 2 + functions.size() + fillerFunctions);
         body.insert(body.end(), {0, 1});
         for (const auto& function : functions)
            leb(body, function.type);
         append(body, repeated(fillerFunctions, {2}));
         emit(3);
         if (!tables.empty())
         {
            leb(body, tables.size());
            for (auto initial : tables)
            {
               append(body, tableType);
               body.push_back(0);
               leb(body, initial);
            }
            emit(4);
         }
         if (!memories.empty())
         {
            leb(body, memories.size());
            for (auto initial : memories)
            {
               body.push_back(0);
               leb(body, initial);
            }
            emit(5);
         }
         if (globalCount)
         {
            leb(body, globalCount);
            append(body, globals);
            emit(6);
         }
         leb(body, 2 + exportCount);
         append(body, nameBytes("start"));
         body.push_back(0);
         leb(body, imports);
         append(body, nameBytes("called"));
         body.push_back(0);
         leb(body, imports + 1);
         append(body, exports);
         emit(7);
         if (elementCount)
         {
            leb(body, elementCount);
            append(body, elements);
            emit(9);
         }
         leb(body, 2 + functions.size() + fillerFunctions);
         body.insert(body.end(), {2, 0, 0x0b});
         leb(body, calledBody.size() + 2);
         body.push_back(0);
         append(body, calledBody);
         body.push_back(0x0b);
         for (const auto& function : functions)
         {
            leb(body, function.body.size());
            append(body, function.body);
         }
         append(body, repeated(fillerFunctions, {2, 0, 0x0b}));
         emit(10);
         if (dataCount)
         {
            leb(body, dataCount);
            append(body, data);
            emit(11);
         }
         for (const auto& name : customs)
         {
            append(body, nameBytes(name));
            emit(0);
         }
         if (size)
         {
            // A custom section named "pad" that brings the module to `size`.
            REQUIRE(code.size() + 16 <= size);
            const auto total = size - code.size();  // id, length, payload
            for (std::size_t width = 1; width <= 5; ++width)
            {
               const auto payload = total - 1 - width;
               if (lebBytes(payload).size() != width)
                  continue;
               Bytes pad = nameBytes("pad");
               pad.resize(payload, 0);
               section(code, 0, pad);
               break;
            }
            // A size at which the length's encoding grows by a byte cannot
            // be hit exactly; the callers' sizes are not such.
            REQUIRE(code.size() == size);
         }
         return code;
      }
   };

   // `count` pushes of a constant of the given type (0x7f i32, 0x7e i64).
   Bytes pushes(std::uint32_t count, std::uint8_t type = 0x7f)
   {
      return repeated(count, {std::uint8_t(type == 0x7f ? 0x41 : 0x42), 0});
   }

   // The body of a function () -> () whose measure (max_branch_local_pairs,
   // defined at vmOptionCeilings) is exactly `pairs`: a block with
   // pairs / 1,000 edges into its end in which 1,000 locals are written,
   // and a block with one edge in which the remainder are. No local is
   // read, so a compiler has nothing to merge: the function is cheap to
   // compile at any size.
   Bytes pairsFunction(std::uint32_t pairs)
   {
      constexpr std::uint32_t locals = 1000;
      Bytes                   body{1};
      leb(body, locals);
      body.push_back(0x7f);
      auto region = [&](std::uint32_t edges, std::uint32_t written)
      {
         body.insert(body.end(), {0x02, 0x40});
         for (std::uint32_t local = 0; local < written; ++local)
         {
            body.insert(body.end(), {0x41, 0, 0x21});
            leb(body, local);
         }
         append(body, repeated(edges - 1, {0x41, 0, 0x0d, 0}));  // i32.const 0, br_if 0
         body.push_back(0x0b);
      };
      if (pairs / locals)
         region(pairs / locals, locals);
      if (pairs % locals)
         region(1, pairs % locals);
      body.push_back(0x0b);
      return body;
   }

   // The module family of the compile-cost measurements
   // (gofractally/psibase#2267; gen_compile_cost_modules.py writes the same
   // shapes): a function (i32) -> i64 with `locals` parameters and locals.
   // `merges` times in sequence, a block is reached by an arm that writes
   // every local and by `edges` more edges, from one br_table or from as
   // many br_if. `written` false leaves the locals unwritten; `read` false
   // drops their sum after the last merge instead of returning it.
   struct CostFunction
   {
      std::uint32_t locals;
      std::uint32_t edges;
      std::uint32_t merges  = 1;
      bool          table   = true;
      bool          written = true;
      bool          read    = true;
      Bytes         body() const
      {
         Bytes body{1};
         leb(body, locals - 1);
         body.push_back(0x7e);
         auto readAll = [&]
         {
            body.insert(body.end(), {0x20, 1});
            for (std::uint32_t local = 2; local < locals; ++local)
            {
               body.push_back(0x20);
               leb(body, local);
               body.push_back(0x7c);
            }
         };
         for (std::uint32_t merge = 0; merge < merges; ++merge)
         {
            body.insert(body.end(), {0x02, 0x40, 0x02, 0x40, 0x20, 0, 0x04, 0x40});
            for (std::uint32_t local = 1; written && local < locals; ++local)
            {
               body.insert(body.end(), {0x42, std::uint8_t((local + merge) % 64), 0x21});
               leb(body, local);
            }
            body.insert(body.end(), {0x0c, 2, 0x0b});
            if (table)
            {
               body.insert(body.end(), {0x20, 0, 0x0e});
               leb(body, edges);
               body.resize(body.size() + edges, 1);
               body.push_back(0);
            }
            else
               append(body, repeated(edges, {0x20, 0, 0x0d, 1}));
            body.insert(body.end(), {0x0b, 0x0b});
         }
         readAll();
         if (!read)
            body.insert(body.end(), {0x1a, 0x42, 7});
         body.push_back(0x0b);
         return body;
      }
   };
   // `depth` nested ifs; every local is written in the innermost and read
   // after the outermost. The shape that costs a compiler the most memory
   // for its measure.
   Bytes nestedIfs(std::uint32_t locals, std::uint32_t depth)
   {
      Bytes body{1};
      leb(body, locals - 1);
      body.push_back(0x7e);
      append(body, repeated(depth, {0x20, 0, 0x04, 0x40}));
      for (std::uint32_t local = 1; local < locals; ++local)
      {
         body.insert(body.end(), {0x42, std::uint8_t(local % 64), 0x21});
         leb(body, local);
      }
      append(body, Bytes(depth, 0x0b));
      body.insert(body.end(), {0x20, 1});
      for (std::uint32_t local = 2; local < locals; ++local)
      {
         body.push_back(0x20);
         leb(body, local);
         body.push_back(0x7c);
      }
      body.push_back(0x0b);
      return body;
   }
   // A service with `copies` functions (i32) -> i64 of this body, the first
   // of which is function 2.
   Bytes costModule(const Bytes& body, std::uint32_t copies = 1)
   {
      ServiceModule m;
      auto          type = m.addType({0x7f}, {0x7e});
      for (std::uint32_t i = 0; i < copies; ++i)
         m.addFunction(type, body);
      return m.build();
   }

   struct LimitProbe
   {
      std::string_view          member;
      std::uint32_t psibase::VMOptions::*field;
      // The module in which what the member limits is exactly `value`.
      std::function<Bytes(std::uint32_t value)> module;
      // The default cannot be reached while the other members have their
      // defaults (another limit is reached first), so the probe at the
      // default runs with every other member at its ceiling.
      bool shadowedAtDefault = false;
      // Why a module at the ceiling is not stored and run, if it is not.
      // It is still put through admission.
      std::string_view notRunAtCeiling = {};
      // Why not even that.
      std::string_view notAdmittedAtCeiling = {};
      // The member that refuses the module one above the ceiling, if the
      // ceilings are such that another one is reached at the same point.
      std::string_view aboveCeilingRefusedBy = {};
   };

   const std::vector<LimitProbe>& limitProbes()
   {
      using psibase::VMOptions;
      static const std::vector<LimitProbe> probes = {
          {"max_mutable_global_bytes", &VMOptions::max_mutable_global_bytes,
           [](std::uint32_t bytes)
           {
              // v128 globals of 16 bytes, then i32 globals of 4.
              ServiceModule m;
              Bytes         wide{0x7b, 1, 0xfd, 0x0c};
              wide.resize(wide.size() + 16, 0);
              wide.push_back(0x0b);
              append(m.globals, repeated(bytes / 16, wide));
              append(m.globals, repeated((bytes % 16 + 3) / 4, {0x7f, 1, 0x41, 0, 0x0b}));
              m.globalCount = bytes / 16 + (bytes % 16 + 3) / 4;
              return m.build();
           },
           false, "", "", "max_global_section_elements"},
          {"max_pages", &VMOptions::max_pages,
           [](std::uint32_t pages)
           {
              ServiceModule m;
              m.memories = {pages};
              return m.build();
           },
           false, "a 4 GiB initial memory"},
          {"max_table_elements", &VMOptions::max_table_elements,
           [](std::uint32_t elements)
           {
              ServiceModule m;
              m.tables = {elements};
              return m.build();
           }},
          {"max_module_bytes", &VMOptions::max_module_bytes,
           [](std::uint32_t bytes)
           {
              ServiceModule m;
              m.size = bytes;
              return m.build();
           },
           false, "storage refuses a row above ConfigRow::maxValueSize first"},
          {"max_type_section_elements", &VMOptions::max_type_section_elements,
           [](std::uint32_t count)
           {
              ServiceModule m;
              m.fillerTypes = count - 3;
              return m.build();
           }},
          {"max_import_section_elements", &VMOptions::max_import_section_elements,
           [](std::uint32_t count)
           {
              ServiceModule m;
              m.imports = count;
              return m.build();
           }},
          {"max_function_section_elements", &VMOptions::max_function_section_elements,
           [](std::uint32_t count)
           {
              ServiceModule m;
              m.fillerFunctions = count - 2;
              return m.build();
           }},
          {"max_table_section_elements", &VMOptions::max_table_section_elements,
           [](std::uint32_t count)
           {
              ServiceModule m;
              m.tables.assign(count, 1);
              return m.build();
           }},
          {"max_memory_section_elements", &VMOptions::max_memory_section_elements,
           [](std::uint32_t count)
           {
              ServiceModule m;
              m.memories.assign(count, 1);
              return m.build();
           }},
          {"max_global_section_elements", &VMOptions::max_global_section_elements,
           [](std::uint32_t count)
           {
              ServiceModule m;
              m.globals     = repeated(count, {0x7f, 0, 0x41, 0, 0x0b});
              m.globalCount = count;
              return m.build();
           }},
          {"max_export_section_elements", &VMOptions::max_export_section_elements,
           [](std::uint32_t count)
           {
              ServiceModule m;
              for (std::uint32_t i = 2; i < count; ++i)
                 m.addExport("e" + std::to_string(i), 0, 0);
              return m.build();
           }},
          {"max_element_section_elements", &VMOptions::max_element_section_elements,
           [](std::uint32_t count)
           {
              // Passive segments with no items.
              ServiceModule m;
              m.elements     = repeated(count, {1, 0, 0});
              m.elementCount = count;
              return m.build();
           }},
          {"max_data_section_elements", &VMOptions::max_data_section_elements,
           [](std::uint32_t count)
           {
              // Passive segments with no bytes.
              ServiceModule m;
              m.data      = repeated(count, {1, 0});
              m.dataCount = count;
              return m.build();
           }},
          {"max_element_segment_elements", &VMOptions::max_element_segment_elements,
           [](std::uint32_t items)
           {
              ServiceModule m;
              m.elements = {1, 0};
              leb(m.elements, items);
              m.elements.resize(m.elements.size() + items, 0);  // function 0
              m.elementCount = 1;
              return m.build();
           },
           false, "a 10 MB module: storage refuses a row above ConfigRow::maxValueSize first"},
          {"max_data_segment_bytes", &VMOptions::max_data_segment_bytes,
           [](std::uint32_t bytes)
           {
              ServiceModule m;
              m.data = {1};
              leb(m.data, bytes);
              m.data.resize(m.data.size() + bytes, 0);
              m.dataCount = 1;
              return m.build();
           },
           true, "",
           "a segment of max_module_bytes (the same ceiling) does not fit in a module; the "
           "ceiling cannot be reached"},
          {"max_symbol_bytes", &VMOptions::max_symbol_bytes,
           [](std::uint32_t bytes)
           {
              // An export's name and a custom section's name.
              ServiceModule m;
              m.addExport(std::string(bytes, 'n'), 0, 0);
              m.customs = {std::string(bytes, 'c')};
              return m.build();
           }},
          {"max_type_size", &VMOptions::max_type_size,
           [](std::uint32_t size)
           {
              // 1, start 3 and called 4; then exports of a function with
              // 998 parameters (1,000 each), one with what is left over,
              // and the memory (1 each).
              ServiceModule m;
              m.memories       = {1};
              auto          rest  = size - 8;
              auto          large = m.addFunction(m.addType(Bytes(998, 0x7f), {}), {0, 0x0b});
              std::uint32_t names = 0;
              for (; rest >= 1000; rest -= 1000)
                 m.addExport("l" + std::to_string(names++), 0, large);
              if (rest >= 2)
              {
                 m.addExport("r", 0, m.addFunction(m.addType(Bytes(rest - 2, 0x7f), {}), {0, 0x0b}));
                 rest = 0;
              }
              for (; rest; --rest)
                 m.addExport("m" + std::to_string(names++), 2, 0);
              return m.build();
           },
           true},
          {"max_function_params", &VMOptions::max_function_params,
           [](std::uint32_t count)
           {
              ServiceModule m;
              auto probe   = m.addFunction(m.addType(Bytes(count, 0x7f), {}), {0, 0x0b});
              m.calledBody = pushes(count);
              m.calledBody.push_back(0x10);
              leb(m.calledBody, probe);
              return m.build();
           }},
          {"max_function_results", &VMOptions::max_function_results,
           [](std::uint32_t count)
           {
              ServiceModule m;
              Bytes         body{0};
              append(body, pushes(count));
              body.push_back(0x0b);
              auto probe   = m.addFunction(m.addType({}, Bytes(count, 0x7f)), body);
              m.calledBody = {0x10};
              leb(m.calledBody, probe);
              append(m.calledBody, Bytes(count, 0x1a));
              return m.build();
           }},
          {"max_function_locals", &VMOptions::max_function_locals,
           [](std::uint32_t count)
           {
              // One parameter and the rest declared.
              ServiceModule m;
              Bytes         body{1};
              leb(body, count - 1);
              body.insert(body.end(), {0x7f, 0x0b});
              auto probe   = m.addFunction(m.addType({0x7f}, {}), body);
              m.calledBody = {0x41, 0, 0x10};
              leb(m.calledBody, probe);
              return m.build();
           }},
          {"max_func_local_bytes", &VMOptions::max_func_local_bytes,
           [](std::uint32_t bytes)
           {
              // i64 operands of 8 bytes, then i32 operands of 4.
              ServiceModule m;
              Bytes         body{0};
              append(body, pushes(bytes / 8, 0x7e));
              append(body, pushes((bytes % 8 + 3) / 4));
              append(body, Bytes(bytes / 8 + (bytes % 8 + 3) / 4, 0x1a));
              body.push_back(0x0b);
              auto probe   = m.addFunction(2, body);
              m.calledBody = {0x10};
              leb(m.calledBody, probe);
              return m.build();
           },
           false,
           "a call takes these bytes plus 16 from the stack budget, and the two ceilings are "
           "equal (16 MiB): the function is admitted and can never be called"},
          {"max_code_bytes", &VMOptions::max_code_bytes,
           [](std::uint32_t bytes)
           {
              ServiceModule m;
              Bytes         body(bytes, 0x01);  // nop
              body.front() = 0;
              body.back()  = 0x0b;
              auto probe   = m.addFunction(2, body);
              m.calledBody = {0x10};
              leb(m.calledBody, probe);
              return m.build();
           }},
          {"max_br_table_elements", &VMOptions::max_br_table_elements,
           [](std::uint32_t targets)
           {
              ServiceModule m;
              Bytes         body{0, 0x02, 0x40, 0x41, 0, 0x0e};
              leb(body, targets);
              body.resize(body.size() + targets + 1, 0);
              body.insert(body.end(), {0x0b, 0x0b});
              auto probe   = m.addFunction(2, body);
              m.calledBody = {0x10};
              leb(m.calledBody, probe);
              return m.build();
           }},
          {"max_nested_structures", &VMOptions::max_nested_structures,
           [](std::uint32_t depth)
           {
              // The function counts as one.
              ServiceModule m;
              Bytes         body{0};
              append(body, repeated(depth - 1, {0x02, 0x40}));
              append(body, Bytes(depth - 1, 0x0b));
              body.push_back(0x0b);
              auto probe   = m.addFunction(2, body);
              m.calledBody = {0x10};
              leb(m.calledBody, probe);
              return m.build();
           }},
          {"max_block_params", &VMOptions::max_block_params,
           [](std::uint32_t count)
           {
              // An if with `count` parameters: the form LLVM AOT and JIT2
              // cannot compile above 16 (gofractally/psizam#5).
              ServiceModule m;
              auto          type = m.addType(Bytes(count, 0x7f), {});
              Bytes         body{0};
              append(body, pushes(count));
              body.insert(body.end(), {0x41, 1, 0x04});
              leb(body, type);
              append(body, Bytes(count, 0x1a));
              body.push_back(0x05);
              append(body, Bytes(count, 0x1a));
              body.insert(body.end(), {0x0b, 0x0b});
              auto probe   = m.addFunction(2, body);
              m.calledBody = {0x10};
              leb(m.calledBody, probe);
              return m.build();
           }},
          {"max_branch_local_pairs", &VMOptions::max_branch_local_pairs,
           [](std::uint32_t pairs)
           {
              ServiceModule m;
              auto          probe = m.addFunction(2, pairsFunction(pairs));
              m.calledBody        = {0x10};
              leb(m.calledBody, probe);
              return m.build();
           }},
          {"max_module_branch_local_pairs", &VMOptions::max_module_branch_local_pairs,
           [](std::uint32_t pairs)
           {
              // Functions of at most 500,000 each, which is below the
              // default of max_branch_local_pairs.
              ServiceModule m;
              m.calledBody = {};
              for (std::uint32_t left = pairs; left;)
              {
                 const auto part  = std::min<std::uint32_t>(left, 500'000);
                 auto       probe = m.addFunction(2, pairsFunction(part));
                 m.calledBody.push_back(0x10);
                 leb(m.calledBody, probe);
                 left -= part;
              }
              return m.build();
           }},
      };
      return probes;
   }

   // Stores the code as a write of its row does, makes it the code of a new
   // account and executes `called` there.
   void storeAndRun(NativeService& fixture, const Bytes& code)
   {
      const psibase::AccountNumber account{"vm-limit"};
      CodeWriter                   writer{fixture};
      REQUIRE_NOTHROW(writer.put(psibase::DbId::native, code));
      REQUIRE(writer.stored(psibase::DbId::native, code));
      psibase::CodeRow row{.codeNum = account, .codeHash = CodeWriter::row(code).codeHash};
      fixture.block.db.kvPut(row.db, row.key(), row);
      CHECK_NOTHROW(fixture.called(writer.transaction, account));
   }

   void setLimits(NativeService& fixture, const psibase::VMOptions& limits)
   {
      psibase::WasmConfigRow row;
      row.vmOptions = limits;
      fixture.block.db.kvPut(psibase::DbId::native,
                             row.key(psibase::transactionWasmConfigTable), row);
   }

   const psibase::VMOptionCeiling& ceilingOf(std::uint32_t psibase::VMOptions::*field)
   {
      for (const auto& entry : psibase::vmOptionCeilings)
         if (entry.member == field)
            return entry;
      throw std::runtime_error("no ceiling");
   }
}  // namespace

TEST_CASE("Every member of the wasm configuration has a ceiling and a probe", "[limits]")
{
   // The table itself is checked where it is defined (static_assert); here,
   // that its names are the reflected names, in order, and that every member
   // but the stack budget, which no module can exceed by itself, is probed.
   using Reflected = psio::reflect<psibase::VMOptions>;
   REQUIRE(Reflected::member_count == psibase::vmOptionCeilings.size());
   for (std::size_t i = 0; i < psibase::vmOptionCeilings.size(); ++i)
   {
      const auto& entry = psibase::vmOptionCeilings[i];
      INFO(entry.name);
      CHECK(Reflected::find_index(entry.name) == i);
      CHECK(!entry.source.empty());
      const bool probed =
          std::ranges::any_of(limitProbes(), [&](const auto& p) { return p.field == entry.member; });
      CHECK(probed == (entry.name != "max_stack_bytes"));
   }
   for (const auto& probe : limitProbes())
      CHECK(ceilingOf(probe.field).name == probe.member);
}

TEST_CASE("A module at a default limit is stored and runs; one above is refused by name",
          "[limits]")
{
   if (!isWasmtime())
      SKIP("stores code as the wasmtime engine does");
   TempDirectory artifacts;
   for (const auto& probe : limitProbes())
   {
      DYNAMIC_SECTION(probe.member)
      {
         const auto         limit = psibase::VMOptions{}.*probe.field;
         psibase::VMOptions limits;
         if (probe.shadowedAtDefault)
         {
            limits              = psibase::vmOptionsAtCeiling();
            limits.*probe.field = limit;
         }
         const auto at     = probe.module(limit);
         const auto above  = probe.module(limit + 1);
         const auto reason = "exceeds " + std::string(probe.member);
         if (probe.member == "max_module_bytes" || probe.member == "max_data_segment_bytes")
         {
            // The row of an 8 MiB module is larger than the largest value
            // storage takes by default; admission is asked directly.
            CHECK_NOTHROW(psibase::admitNativeWasm(at, limits, 0));
            CHECK_THROWS_WITH(psibase::admitNativeWasm(above, limits, 0),
                              Catch::Matchers::ContainsSubstring(reason));
         }
         else
         {
            NativeService fixture{artifacts.path / "modules"};
            if (probe.shadowedAtDefault)
               setLimits(fixture, limits);
            storeAndRun(fixture, at);
            CodeWriter writer{fixture};
            CHECK_THROWS_WITH(writer.put(psibase::DbId::native, above),
                              Catch::Matchers::ContainsSubstring(reason));
            CHECK_FALSE(writer.stored(psibase::DbId::native, above));
         }
      }
   }
}

TEST_CASE("A configuration row is accepted at every ceiling and refused above any", "[limits]")
{
   NativeService fixture;
   // A privileged service's host, in a transaction that has run.
   CodeWriter writer{fixture};
   auto&      host   = writer.host;
   auto       handle = host.kvOpen(static_cast<uint32_t>(psibase::DbId::native), {},
                                   static_cast<uint32_t>(psibase::KvMode::write));
   for (auto table : {psibase::transactionWasmConfigTable, psibase::proofWasmConfigTable})
   {
      auto key = psio::encode(psio::key{}, psibase::WasmConfigRow::key(table));
      psibase::WasmConfigRow row;
      CHECK_NOTHROW(host.kvPut(handle, key, psio::to_pssz(row)));
      // All of them at once.
      row.vmOptions = psibase::vmOptionsAtCeiling();
      CHECK_NOTHROW(host.kvPut(handle, key, psio::to_pssz(row)));
      for (const auto& entry : psibase::vmOptionCeilings)
      {
         INFO(entry.name);
         psibase::WasmConfigRow one;
         one.vmOptions.*entry.member = entry.ceiling;
         CHECK_NOTHROW(host.kvPut(handle, key, psio::to_pssz(one)));
         one.vmOptions.*entry.member = entry.ceiling + 1;
         CHECK_THROWS_WITH(host.kvPut(handle, key, psio::to_pssz(one)),
                           Catch::Matchers::ContainsSubstring(std::string(entry.name) + " is ") &&
                               Catch::Matchers::ContainsSubstring(
                                   "ceiling of " + std::to_string(entry.ceiling)));
         // The refused row replaced nothing.
         auto retained = fixture.block.db.kvGetRaw(psibase::DbId::native, key);
         REQUIRE(retained.has_value());
         one.vmOptions.*entry.member = entry.ceiling;
         CHECK(std::ranges::equal(*retained, psio::to_pssz(one)));
      }
   }
}

TEST_CASE("A chain configured at the ceilings stores and runs a module at each ceiling",
          "[limits]")
{
   if (!isWasmtime())
      SKIP("stores code as the wasmtime engine does");
   TempDirectory artifacts;
   const auto    limits = psibase::vmOptionsAtCeiling();
   for (const auto& probe : limitProbes())
   {
      DYNAMIC_SECTION(probe.member)
      {
         const auto ceiling = ceilingOf(probe.field).ceiling;
         if (!probe.notAdmittedAtCeiling.empty())
         {
            WARN(probe.member << " not probed at its ceiling: " << probe.notAdmittedAtCeiling);
            continue;
         }
         const auto at = probe.module(ceiling);
         // One above the ceiling is refused by admission under the ceiling
         // configuration, by name.
         CHECK_THROWS_WITH(
             psibase::admitNativeWasm(probe.module(ceiling + 1), limits, 0),
             Catch::Matchers::ContainsSubstring(
                 "exceeds " + std::string(probe.aboveCeilingRefusedBy.empty()
                                              ? probe.member
                                              : probe.aboveCeilingRefusedBy)));
         if (!probe.notRunAtCeiling.empty())
         {
            CHECK_NOTHROW(psibase::admitNativeWasm(at, limits, 0));
            WARN(probe.member << " admitted at its ceiling but not stored and run: "
                              << probe.notRunAtCeiling);
            continue;
         }
         NativeService fixture{artifacts.path / "modules"};
         setLimits(fixture, limits);
         storeAndRun(fixture, at);
      }
   }
}

TEST_CASE("What wasmtime refuses is refused by admission under the default limits", "[limits]")
{
   using Catch::Matchers::ContainsSubstring;
   auto function = [](Bytes body)
   {
      ServiceModule m;
      m.addFunction(2, std::move(body));
      return m.build();
   };
   auto refused = [](const Bytes& code, std::string_view reason)
   {
      INFO(reason);
      CHECK_THROWS_WITH(psibase::admitNativeWasm(code, {}, 0),
                        ContainsSubstring(std::string(reason)));
   };
   const auto& probes = limitProbes();
   auto        probe  = [&](std::string_view member, std::uint32_t value)
   {
      for (const auto& p : probes)
         if (p.member == member)
            return p.module(value);
      throw std::runtime_error("no probe");
   };
   // The four of the original report (gofractally/psibase#2262): 50,001
   // locals, 1,001 parameters, a name of 100,001 bytes, a function body of
   // 7,654,322 bytes.
   refused(probe("max_function_locals", 50'001), "exceeds max_function_locals");
   refused(probe("max_function_params", 1'001), "exceeds max_function_params");
   refused(probe("max_symbol_bytes", 100'001), "exceeds max_symbol_bytes");
   refused(probe("max_code_bytes", 7'654'322), "exceeds max_code_bytes");
   // The survey's: a br_table of 65,521 targets; an effective type size of
   // 1,000,000 in an 8 KB module; a custom section name of 100,001 bytes;
   // the counts wasmparser caps.
   refused(probe("max_br_table_elements", 65'521), "exceeds max_br_table_elements");
   {
      ServiceModule m;
      auto          large = m.addFunction(m.addType(Bytes(998, 0x7f), {}), {0, 0x0b});
      for (int i = 0; i < 1000; ++i)
         m.addExport("l" + std::to_string(i), 0, large);
      const auto code = m.build();
      CHECK(code.size() < 16 * 1024);
      refused(code, "exceeds max_");
      // And by the type size itself where nothing else is in the way.
      auto limits                        = psibase::vmOptionsAtCeiling();
      limits.max_type_size               = psibase::VMOptions{}.max_type_size;
      CHECK_THROWS_WITH(psibase::admitNativeWasm(code, limits, 0),
                        ContainsSubstring("exceeds max_type_size"));
   }
   {
      ServiceModule m;
      m.customs = {std::string(100'001, 'c')};
      refused(m.build(), "exceeds max_symbol_bytes");
   }
   refused(probe("max_data_section_elements", 100'001), "exceeds max_data_section_elements");
   refused(probe("max_element_section_elements", 100'001),
           "exceeds max_element_section_elements");
   refused(probe("max_global_section_elements", 1'000'001),
           "exceeds max_global_section_elements");
   refused(probe("max_type_section_elements", 1'000'001), "exceeds max_type_section_elements");
   refused(probe("max_function_section_elements", 1'000'001),
           "exceeds max_function_section_elements");
   // (An export or import section of 1,000,001 entries is a module above
   // max_module_bytes; their limits are probed at their own values.)
   // Extended constant expressions (gofractally/psibase#2266): in a global's
   // initialiser, a data segment's offset and an element segment's offset.
   {
      ServiceModule m;
      m.globals     = {0x7f, 0, 0x41, 1, 0x41, 2, 0x6a, 0x0b};
      m.globalCount = 1;
      refused(m.build(), "extended constant expressions");
   }
   {
      ServiceModule m;
      m.memories  = {1};
      m.data      = {0, 0x41, 1, 0x41, 2, 0x6a, 0x0b, 0};
      m.dataCount = 1;
      refused(m.build(), "extended constant expressions");
   }
   {
      ServiceModule m;
      m.tables       = {1};
      m.elements     = {0, 0x41, 0, 0x41, 0, 0x6c, 0x0b, 0};
      m.elementCount = 1;
      refused(m.build(), "extended constant expressions");
   }
   // The plain forms of the same are admitted.
   {
      ServiceModule m;
      m.memories     = {1};
      m.tables       = {1};
      m.globals      = {0x7f, 0, 0x41, 1, 0x0b, 0x70, 0, 0xd0, 0x70, 0x0b, 0x70, 0, 0xd2, 0, 0x0b};
      m.globalCount  = 3;
      m.data         = {0, 0x41, 1, 0x0b, 1, 0xaa, 1, 0};
      m.dataCount    = 2;
      m.elements     = {0, 0x41, 0, 0x0b, 1, 0};
      m.elementCount = 1;
      CHECK_NOTHROW(psibase::admitNativeWasm(m.build(), {}, 0));
   }
   // Typed function references (off; see NativeVMOptions): the two-byte
   // reference types (ref ht) and (ref null ht), wherever a type can be
   // written, and ref.null with a type index. The first pass refuses those
   // it reads as it walks the declarations ("typed function references";
   // for a table, "funcref table"), psizam's parser the ones in instructions
   // ("typed references not enabled", gofractally/psizam#6).
   // A parameter and a local.
   {
      ServiceModule m;
      m.addFunction(m.addType({0x64, 0x70}, {}), {0, 0x0b});
      refused(m.build(), "typed function references");
   }
   refused(function({1, 1, 0x63, 0x70, 0x0b}), "typed function references");
   // A block type: block (result (ref func)) unreachable end drop, and the
   // nullable form on a loop and an if.
   refused(function({0, 0x02, 0x64, 0x70, 0x00, 0x0b, 0x1a, 0x0b}),
           "typed references not enabled");
   refused(function({0, 0x03, 0x63, 0x70, 0x00, 0x0b, 0x1a, 0x0b}),
           "typed references not enabled");
   refused(function({0, 0x41, 0, 0x04, 0x63, 0x70, 0x00, 0x05, 0x00, 0x0b, 0x1a, 0x0b}),
           "typed references not enabled");
   // A table of (ref null func).
   {
      ServiceModule m;
      m.tables    = {1};
      m.tableType = {0x63, 0x70};
      refused(m.build(), "funcref table");
   }
   // An element segment of (ref func): passive, of expressions, empty.
   {
      ServiceModule m;
      m.elements     = {5, 0x64, 0x70, 0};
      m.elementCount = 1;
      refused(m.build(), "typed function references");
   }
   // ref.null with a type index (type 2, () -> ()).
   refused(function({0, 0xd0, 0x02, 0x1a, 0x0b}), "typed references not enabled");
   // The one-byte forms of the same are admitted.
   {
      ServiceModule m;
      m.tables       = {1};
      m.elements     = {5, 0x70, 0};
      m.elementCount = 1;
      m.addFunction(2, {0, 0x02, 0x70, 0xd0, 0x70, 0x0b, 0x1a, 0x0b});
      CHECK_NOTHROW(psibase::admitNativeWasm(m.build(), {}, 0));
   }
   // Where psizam's validator accepted what wasmtime refuses
   // (gofractally/psizam#7), one case of each kind and of each place.
   // A global initialised with ref.func of a function that does not exist.
   {
      ServiceModule m;
      m.globals     = {0x70, 0, 0xd2, 9, 0x0b};
      m.globalCount = 1;
      refused(m.build(), "ref.func of an undefined function");
   }
   // A funcref global initialised with ref.null extern.
   {
      ServiceModule m;
      m.globals     = {0x70, 0, 0xd0, 0x6f, 0x0b};
      m.globalCount = 1;
      refused(m.build(), "type mismatch");
   }
   // Exception handling is off: the legacy try, and the type exnref as a
   // local and as a block type.
   refused(function({0, 0x06, 0x40, 0x0b, 0x0b}), "Exception handling not enabled");
   refused(function({1, 1, 0x69, 0x0b}), "invalid local type");
   refused(function({0, 0x02, 0x69, 0x00, 0x0b, 0x1a, 0x0b}), "Invalid type code in block");
   // global.get of a global the module defines, in a constant expression
   // (NativeVMOptions::enable_const_defined_globals): a global's
   // initialiser, an element segment's offset and item, a data segment's
   // offset.
   const std::string_view definedGlobal = "global.get of a defined global";
   {
      ServiceModule m;
      m.globals     = {0x7f, 0, 0x41, 1, 0x0b, 0x7f, 0, 0x23, 0, 0x0b};
      m.globalCount = 2;
      refused(m.build(), definedGlobal);
   }
   {
      ServiceModule m;
      m.tables       = {1};
      m.globals      = {0x7f, 0, 0x41, 0, 0x0b};
      m.globalCount  = 1;
      m.elements     = {0, 0x23, 0, 0x0b, 0};
      m.elementCount = 1;
      refused(m.build(), definedGlobal);
   }
   {
      ServiceModule m;
      m.globals      = {0x70, 0, 0xd0, 0x70, 0x0b};
      m.globalCount  = 1;
      m.elements     = {5, 0x70, 1, 0x23, 0, 0x0b};
      m.elementCount = 1;
      refused(m.build(), definedGlobal);
   }
   {
      ServiceModule m;
      m.memories    = {1};
      m.globals     = {0x7f, 0, 0x41, 0, 0x0b};
      m.globalCount = 1;
      m.data        = {0, 0x23, 0, 0x0b, 0};
      m.dataCount   = 1;
      refused(m.build(), definedGlobal);
   }
}

TEST_CASE("The measure of branch edges times locals is the one defined", "[limits]")
{
   // The definition is at vmOptionCeilings (PsizamPolicy.hpp). Each body is
   // a function () -> () with four i32 locals unless it says otherwise; the
   // measures of start and called, which have no region and no result, are 0.
   struct Case
   {
      std::string_view name;
      Bytes            instructions;
      std::uint64_t    pairs;
      Bytes            results = {};
   };
   const Bytes set0{0x41, 0, 0x21, 0}, set1{0x41, 0, 0x21, 1}, brIf0{0x41, 0, 0x0d, 0};
   auto        all = [](std::initializer_list<Bytes> parts)
   {
      Bytes result;
      for (const auto& part : parts)
         append(result, part);
      return result;
   };
   const std::vector<Case> cases = {
       {"no region", all({set0, set1}), 0},
       {"a block: its end and two branches, one local", all({{0x02, 0x40}, set0, brIf0, brIf0, {0x0b}}),
        3},
       {"a loop: its entry and a back edge, two locals",
        all({{0x03, 0x40}, set0, set1, brIf0, {0x0b}}), 4},
       {"an if: two arms, a local written in each",
        all({{0x41, 0, 0x04, 0x40}, set0, {0x05}, set1, {0x0b}}), 4},
       {"an if without else has two edges as well", all({{0x41, 0, 0x04, 0x40}, set0, {0x0b}}), 2},
       {"a local written twice is one; local.tee is a write",
        all({{0x02, 0x40}, set0, {0x41, 0, 0x22, 0, 0x1a}, {0x0b}}), 1},
       {"a write before the region is not in it", all({set0, {0x02, 0x40}, brIf0, {0x0b}}), 0},
       {"a write inside an inner region is inside the outer one",
        all({{0x02, 0x40, 0x02, 0x40}, set0, {0x0c, 1, 0x0b}, set1, {0x0b}}), 1 * 1 + 2 * 2},
       {"the same local in the outer and the inner region",
        all({{0x02, 0x40}, set0, {0x02, 0x40}, set0, {0x0b, 0x0b}}), 1 + 1},
       {"written in an inner region, again after it, with a region between",
        all({{0x02, 0x40, 0x02, 0x40}, set0, {0x0b}, set0, {0x02, 0x40, 0x0b}, set1, {0x0b}}),
        1 + 0 + 2},
       {"a br_table: every entry and the default",
        all({{0x02, 0x40}, set0, {0x41, 0, 0x0e, 3, 0, 0, 0, 0, 0x0b}}), 5},
       {"a branch counts for the region it names",
        all({{0x02, 0x40}, set0, {0x02, 0x40}, set1, {0x41, 0, 0x0d, 1}, {0x0b, 0x0b}}),
        1 * 1 + 2 * 2},
       {"operands a branch carries: the result of a block",
        all({{0x02, 0x7f, 0x41, 1}, brIf0, {0x0b, 0x1a}}), 2 * 1},
       {"operands a branch carries: the function's results",
        all({{0x41, 1, 0x41, 0, 0x0d, 0}}), 2 * 1, {0x7f}},
       {"unreachable code counts", all({{0x02, 0x40, 0x00}, set0, {0x0c, 0, 0x0b}}), 2},
   };
   for (const auto& c : cases)
   {
      INFO(c.name);
      ServiceModule m;
      Bytes         body{1, 4, 0x7f};
      append(body, c.instructions);
      body.push_back(0x0b);
      m.addFunction(c.results.empty() ? 2 : m.addType({}, c.results), body);
      CHECK(psibase::nativeBranchLocalPairs(m.build(), {}).functions ==
            std::vector<std::uint64_t>{0, 0, c.pairs});
   }
   // The functions of a module do not see each other's writes.
   {
      ServiceModule m;
      Bytes         body{1, 4, 0x7f};
      append(body, all({{0x02, 0x40}, set0, set1, brIf0, {0x0b, 0x0b}}));
      m.addFunction(2, body);
      m.addFunction(2, body);
      CHECK(psibase::nativeBranchLocalPairs(m.build(), {}).functions ==
            std::vector<std::uint64_t>{0, 0, 4, 4});
   }
   {
      ServiceModule m;
      m.addFunction(2, pairsFunction(1'234'567));
      CHECK(psibase::nativeBranchLocalPairs(m.build(), {}).functions ==
            std::vector<std::uint64_t>{0, 0, 1'234'567});
   }
}

TEST_CASE("A function or module above the branch-local limit is refused by name and index",
          "[limits]")
{
   using Catch::Matchers::ContainsSubstring;
   const psibase::VMOptions defaults;
   auto                     one = [](std::uint32_t imports, std::uint32_t pairs)
   {
      ServiceModule m;
      m.imports = imports;
      m.addFunction(2, pairsFunction(pairs));
      return m.build();
   };
   CHECK_NOTHROW(psibase::admitNativeWasm(one(0, defaults.max_branch_local_pairs), {}, 0));
   CHECK_THROWS_WITH(
       psibase::admitNativeWasm(one(0, defaults.max_branch_local_pairs + 1), {}, 0),
       ContainsSubstring("exceeds max_branch_local_pairs: 524289 is more than 524288 in function 2"));
   // The index is the one of the function index space: imports count.
   CHECK_THROWS_WITH(
       psibase::admitNativeWasm(one(3, defaults.max_branch_local_pairs + 1), {}, 0),
       ContainsSubstring("exceeds max_branch_local_pairs: 524289 is more than 524288 in function 5"));
   // The module's sum: nine functions of 500,000 are 4,500,000, and the
   // ninth (function 10) is where the sum passes the limit.
   {
      ServiceModule m;
      for (int i = 0; i < 9; ++i)
         m.addFunction(2, pairsFunction(500'000));
      CHECK_THROWS_WITH(psibase::admitNativeWasm(m.build(), {}, 0),
                        ContainsSubstring("exceeds max_module_branch_local_pairs: 4500000 is more "
                                          "than 4194304 at function 10"));
      // With that limit raised nothing else refuses it.
      auto limits                          = defaults;
      limits.max_module_branch_local_pairs = 4'500'000;
      CHECK_NOTHROW(psibase::admitNativeWasm(m.build(), limits, 0));
   }
}

TEST_CASE("The modules that cost the compiler minutes and gigabytes are refused", "[limits]")
{
   // gofractally/psibase#2267. Each was admitted before these limits; what
   // each cost wasmtime's compiler is in the issue.
   using Catch::Matchers::ContainsSubstring;
   auto refused = [](const Bytes& code, const psibase::VMOptions& limits, std::string_view reason)
   {
      CHECK_THROWS_WITH(psibase::admitNativeWasm(code, limits, 0),
                        ContainsSubstring(std::string(reason)));
   };
   const std::string_view function = "exceeds max_branch_local_pairs: ";
   const std::string_view module   = "exceeds max_module_branch_local_pairs: ";
   // 2,047 locals and a br_table of 4,096 targets, 24 KB: 38 CPU seconds
   // and 1.4 GiB. Its measure is 4,098 edges x 2,046 locals written, and
   // 2 x 2,046 for each of the block and the if around the writes, and 1.
   {
      INFO("one br_table");
      const auto code = costModule(CostFunction{2047, 4096, 1, true, true, false}.body());
      CHECK(code.size() < 32 * 1024);
      CHECK(psibase::nativeBranchLocalPairs(code, {}).functions.back() ==
            4098u * 2046 + 2 * 2 * 2046 + 1);
      refused(code, {}, std::string(function) + "8392693 is more than 524288 in function 2");
   }
   {
      INFO("the same with br_if: max_br_table_elements does not see it");
      refused(costModule(CostFunction{2047, 4096, 1, false}.body()), {}, function);
   }
   {
      INFO("two merges of 512 x 512: 29 CPU seconds in 9 KB");
      refused(costModule(CostFunction{512, 512, 2}.body()), {}, function);
   }
   {
      INFO("four tables, 97 KB: 5 GiB, and days on the pinned register allocator");
      refused(costModule(CostFunction{2047, 4096, 4, true, true, false}.body()), {}, function);
   }
   {
      INFO("1,000 nested ifs, no branch instruction at all, 23 KB: 3.5 GiB");
      const auto code = costModule(nestedIfs(2047, 1000));
      CHECK(code.size() < 32 * 1024);
      refused(code, {}, std::string(function) + "4092001 is more than 524288 in function 2");
   }
   {
      INFO("the survey's 4,000 x 4,000, on a chain with every limit at its ceiling");
      refused(costModule(CostFunction{4000, 4000}.body()), psibase::vmOptionsAtCeiling(),
              function);
   }
   {
      INFO("sixteen functions that each pass, compiled at once");
      const auto body = CostFunction{512, 1000}.body();
      CHECK_NOTHROW(psibase::admitNativeWasm(costModule(body), {}, 0));
      refused(costModule(body, 16), {}, module);
   }
   {
      // The measure is not the product of locals and targets: where no
      // local is written there is nothing to merge, the compiler needs
      // nothing extra (measured), and the module is admitted.
      INFO("2,047 locals never written and 4,096 targets");
      const auto code = costModule(CostFunction{2047, 4096, 1, true, false}.body());
      CHECK(psibase::nativeBranchLocalPairs(code, {}).functions.back() == 1);
      CHECK_NOTHROW(psibase::admitNativeWasm(code, {}, 0));
   }
}

TEST_CASE("A module at the ceilings that size an instance at once is stored and runs", "[limits]")
{
   if (!isWasmtime())
      SKIP("stores code as the wasmtime engine does");
   // What an instance holds grows with the functions that can be referenced,
   // the globals and the table; wasmtime's instance pool has a size per
   // slot, which this module exceeds twice over (a table of 1,048,576
   // elements against 65,536; an instance above 4 MiB). It is compiled and
   // run on the engine without a pool (gofractally/psibase#2272). Every
   // function is in an element segment, so every one of them can be
   // referenced.
   const auto    limits = psibase::vmOptionsAtCeiling();
   ServiceModule m;
   m.imports         = limits.max_import_section_elements;
   m.fillerFunctions = limits.max_function_section_elements - 2;
   m.globals         = repeated(limits.max_global_section_elements, {0x7f, 1, 0x41, 0, 0x0b});
   m.globalCount     = limits.max_global_section_elements;
   m.tables          = {limits.max_table_elements};
   m.memories        = {1};
   m.elements        = {1, 0};
   const auto all    = limits.max_import_section_elements + limits.max_function_section_elements;
   leb(m.elements, all);
   for (std::uint32_t i = 0; i < all; ++i)
      leb(m.elements, i);
   m.elementCount = 1;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   setLimits(fixture, limits);
   storeAndRun(fixture, m.build());
}

TEST_CASE("A module too large for an instance-pool slot is loaded from the artifact store "
          "after a restart",
          "[limits]")
{
   if (!isWasmtime())
      SKIP("counts compiles and loads, which only the wasmtime engine reports");
   // A table of 1,048,576 elements against the 65,536 of a pool slot: the
   // pooled engine takes this module neither from wasm nor from a stored
   // artifact (gofractally/psibase#2272).
   const auto limits = psibase::vmOptionsAtCeiling();
   const auto code   = [&]
   {
      for (const auto& probe : limitProbes())
         if (probe.member == "max_table_elements")
            return probe.module(limits.max_table_elements);
      throw std::runtime_error("no probe");
   }();
   TempDirectory artifacts;
   // A node that is started over the same artifact store: nothing compiled
   // is in memory. The code is stored as a write of its row does, which asks
   // for the module, made the code of a new account and called there. What is
   // counted is what the cache did for this module alone: the fixture's own
   // services were compiled or loaded before.
   auto run = [&]
   {
      NativeService fixture{artifacts.path / "modules"};
      setLimits(fixture, limits);
      const psibase::AccountNumber account{"vm-limit"};
      CodeWriter                   writer{fixture};
      REQUIRE_NOTHROW(writer.put(psibase::DbId::native, code));
      REQUIRE(writer.stored(psibase::DbId::native, code));
      psibase::CodeRow row{.codeNum = account, .codeHash = CodeWriter::row(code).codeHash};
      fixture.block.db.kvPut(row.db, row.key(), row);
      // Its start returns: the instance was created and ran.
      CHECK_NOTHROW(fixture.called(writer.transaction, account));
      auto stats = fixture.cache.stats();
      stats.compiled -= writer.before.compiled;
      stats.loaded -= writer.before.loaded;
      stats.compiledPoolless -= writer.before.compiledPoolless;
      stats.loadedPoolless -= writer.before.loadedPoolless;
      stats.discarded -= writer.before.discarded;
      return stats;
   };
   auto stats = run();
   CHECK(stats.compiled == 1);
   CHECK(stats.compiledPoolless == 1);
   CHECK(stats.loaded == 0);
   CHECK(stats.loadedPoolless == 0);
   // Restarted: the artifact is loaded, by the engine without a pool, and
   // the service runs there. Nothing is compiled.
   stats = run();
   CHECK(stats.compiled == 0);
   CHECK(stats.compiledPoolless == 0);
   CHECK(stats.loaded == 1);
   CHECK(stats.loadedPoolless == 1);
   CHECK(stats.discarded == 0);
}

// Abandoning a speculative run's compile (gofractally/psibase#2267).
namespace
{
   // An artifact store a test can read: what the engine stored, by key.
   struct RecordedArtifacts
   {
      using Records = std::map<psibase::NativeArtifactStore::Key, std::vector<char>>;
      std::mutex mutex;
      Records    records;
      Records    snapshot()
      {
         std::lock_guard lock{mutex};
         return records;
      }
   };
   struct RecordingStore : psibase::NativeArtifactStore
   {
      std::shared_ptr<RecordedArtifacts> to;
      explicit RecordingStore(std::shared_ptr<RecordedArtifacts> to) : to(std::move(to)) {}
      bool                             usable() const noexcept override { return true; }
      std::optional<std::vector<char>> read(const Key& key) noexcept override
      {
         std::lock_guard lock{to->mutex};
         auto            it = to->records.find(key);
         if (it == to->records.end())
            return std::nullopt;
         return it->second;
      }
      void write(const Key& key, std::span<const char> record) noexcept override
      {
         std::lock_guard lock{to->mutex};
         to->records[key].assign(record.begin(), record.end());
      }
      void erase(const Key& key) noexcept override
      {
         std::lock_guard lock{to->mutex};
         to->records.erase(key);
      }
   };
   std::shared_ptr<psibase::NativeAotCache> recording(std::shared_ptr<RecordedArtifacts> to)
   {
      return std::make_shared<psibase::NativeAotCache>(
          std::make_unique<RecordingStore>(std::move(to)));
   }

   // The most a module may ask of the compiler under the default limits:
   // eight functions of 512 locals and 1,000 branch edges, each just under
   // max_branch_local_pairs and together just under
   // max_module_branch_local_pairs. Compiling it takes the pinned compiler
   // some hundreds of milliseconds on an idle machine.
   Bytes slowToCompile()
   {
      return costModule(CostFunction{512, 1000}.body(), 8);
   }
   std::span<const char> chars(const Bytes& code)
   {
      return {reinterpret_cast<const char*>(code.data()), code.size()};
   }
}  // namespace

TEST_CASE("A speculative run's compile is stopped in the compiler when its bound passes",
          "[limits]")
{
   if (!isWasmtime())
      SKIP("only the wasmtime engine's compiler can be stopped");
   using namespace std::chrono;
   using Catch::Matchers::ContainsSubstring;
   const auto code = slowToCompile();
   const auto hash = CodeWriter::row(code).codeHash;
   {
      const auto pairs = psibase::nativeBranchLocalPairs(code, {}).functions;
      const psibase::VMOptions defaults;
      CHECK(pairs.back() > defaults.max_branch_local_pairs / 100 * 97);
      CHECK(pairs.back() * 8 > defaults.max_module_branch_local_pairs / 100 * 97);
      REQUIRE_NOTHROW(psibase::admitNativeWasm(code, {}, 0));
   }

   // What a compile that nothing disturbs stores for this code, and how
   // long it takes here.
   auto undisturbed = std::make_shared<RecordedArtifacts>();
   {
      NativeService reference{recording(undisturbed)};
      const auto    start = steady_clock::now();
      reference.cache.compileAhead(hash, chars(code), {}, 0);
      UNSCOPED_INFO("an undisturbed compile took "
                    << duration_cast<milliseconds>(steady_clock::now() - start).count() << " ms");
      REQUIRE(reference.cache.contains(hash, {}, 0));
      REQUIRE(undisturbed->snapshot().size() == 1);
   }

   auto             stored = std::make_shared<RecordedArtifacts>();
   NativeService    fixture{recording(stored)};
   std::atomic<int> compilesBegun{0};
   fixture.cache.setCompileHook(
       [&](const psibase::Checksum256& compiling)
       {
          if (compiling == hash)
             ++compilesBegun;
       });
   // Far below what the compile takes, so that the bound passes while the
   // compiler is at work. If the machine is so loaded that the compile
   // thread has not reached the compiler by then, the compile is abandoned
   // as it starts, and everything below holds all the same.
   const auto                   bound = milliseconds(25);
   RecordedArtifacts::Records   storedBefore;
   {
      CodeWriter writer{fixture, psibase::DbMode::speculative()};
      storedBefore = stored->snapshot();
      fixture.cache.setSpeculativeCompileWait(bound);
      const auto chargedBefore = writer.transaction.startedCompileTime;
      // The second run is the same transaction sent again: nothing was
      // remembered of the first compile, so the code is compiled again,
      // under the bound again.
      for (int run = 1; run <= 2; ++run)
      {
         INFO("speculative run " << run);
         CHECK_THROWS_WITH(writer.put(psibase::DbId::native, code),
                           ContainsSubstring("took too long to compile"));
         CHECK_FALSE(writer.stored(psibase::DbId::native, code));
         // The compile thread leaves the compiler; it does not compile on.
         // The limit is generous: what the compiler does not interrupt is a
         // fraction of a second.
         CHECK(fixture.cache.awaitCompile(hash, {}, 0, seconds(5)));
         fixture.cache.finishCompiles();
         CHECK(compilesBegun == run);
         CHECK(fixture.cache.stats().compilesAbandoned == std::uint64_t(run));
         // No module, in memory or stored.
         CHECK(writer.compiled() == 0);
         CHECK_FALSE(fixture.cache.contains(hash, {}, 0));
         CHECK(stored->snapshot() == storedBefore);
      }
      // What the node can charge the submitter is the time its runs waited:
      // the bound, twice.
      CHECK(writer.transaction.startedCompileTime - chargedBefore >= 2 * bound);
   }

   // A producer is offered a transaction that stores the code. Had the
   // abandoned compiles been recorded as the compiler refusing the code,
   // the transaction would be taken as it is; it is deferred, and the
   // compile started for it has no bound: it runs to completion.
   fixture.block.deferUncompiledCode = true;
   CodeWriter writer{fixture};
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(fixture.block.deferral.has_value());
   fixture.cache.finishCompiles();
   CHECK(fixture.cache.contains(hash, {}, 0));
   CHECK(writer.compiled() == 1);
   CHECK(compilesBegun == 3);
   CHECK(fixture.cache.stats().compilesAbandoned == 2);
   // Offered again it is taken, and the code runs.
   fixture.block.deferral.reset();
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK_FALSE(fixture.block.deferral.has_value());
   CHECK(writer.stored(psibase::DbId::native, code));
   const psibase::AccountNumber account{"vm-slow"};
   psibase::CodeRow             row{.codeNum = account, .codeHash = hash};
   fixture.block.db.kvPut(row.db, row.key(), row);
   CHECK_NOTHROW(fixture.called(writer.transaction, account));
   CHECK(writer.compiled() == 1);
   // What was stored for it is, byte for byte, what the undisturbed compile
   // stored: the two abandoned compiles left nothing in the engine.
   auto added = stored->snapshot();
   for (const auto& [key, record] : storedBefore)
      added.erase(key);
   CHECK(added.size() == 1);
   CHECK(added == undisturbed->snapshot());
}

TEST_CASE("A block that needs code whose speculative compile was given up has it compiled",
          "[limits]")
{
   if (!isWasmtime())
      SKIP("only the wasmtime engine's compiler can be stopped");
   using Catch::Matchers::ContainsSubstring;
   const auto                   code = otherService(7);
   const auto                   hash = CodeWriter::row(code).codeHash;
   const psibase::AccountNumber account{"vm-given-up"};

   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   // The node is applying blocks.
   fixture.block.isProducing = false;
   std::size_t before        = 0;
   {
      CodeWriter speculative{fixture, psibase::DbMode::speculative()};
      before = gate.count();
      gate.close();
      fixture.cache.setSpeculativeCompileWait(std::chrono::milliseconds(1));
      CHECK_THROWS_WITH(speculative.put(psibase::DbId::native, code),
                        ContainsSubstring("took too long to compile"));
   }
   // The compile is given up, and its thread is still where the gate holds
   // it. A block arrives that stores the same code: the write does not wait,
   // and no second compile is started beside the one in flight.
   gate.awaitStarted(before + 1);
   CodeWriter writer{fixture};
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(writer.stored(psibase::DbId::native, code));
   CHECK(gate.count() == before + 1);
   CHECK_FALSE(fixture.cache.contains(hash, {}, 0));
   // The block then executes it. The compile thread finds its compile
   // abandoned and, because a block needs the module, compiles the code
   // again without a bound; the execution waits for that and runs the
   // module. The block never sees the abandoned compile as a result.
   psibase::CodeRow row{.codeNum = account, .codeHash = hash};
   fixture.block.db.kvPut(row.db, row.key(), row);
   gate.release();
   CHECK(NativeService::value(fixture.called(writer.transaction, account)) == 8);
   CHECK(fixture.cache.contains(hash, {}, 0));
   CHECK(fixture.cache.stats().compilesAbandoned == 1);
   CHECK(writer.compiled() == 1);
   CHECK(gate.count() == before + 2);
   CHECK_FALSE(gate.compiledHere(before));
}

TEST_CASE("A block that needs code while a speculative run compiles it lifts the bound",
          "[limits]")
{
   if (!isWasmtime())
      SKIP("only the wasmtime engine's compiler can be stopped");
   using Start = psibase::WasmCache::CompileStart;
   using Wait  = psibase::WasmCache::CompileWait;
   const auto                   code = otherService(8);
   const auto                   hash = CodeWriter::row(code).codeHash;
   const psibase::AccountNumber account{"vm-lifted"};

   CompileGate   gate;
   TempDirectory artifacts;
   NativeService fixture{artifacts.path / "modules"};
   auto          release = psibase::finally{[&] { gate.release(); }};
   gate.attach(fixture.cache);
   fixture.block.isProducing = false;
   CodeWriter writer{fixture};
   const auto before = gate.count();
   gate.close();
   // A speculative run starts the compile, which the gate holds, and waits.
   // Long enough for the block below to arrive first on any machine that is
   // not hopelessly loaded; if it does not, the compile is abandoned first
   // and compiled again for the block, and the checks say which happened.
   fixture.cache.setSpeculativeCompileWait(std::chrono::seconds(1));
   std::optional<psibase::WasmCache::SpeculativeCompile> run;
   std::thread speculative{[&, cache = fixture.cache]() mutable
                           { run = cache.compileForSpeculativeRun(hash, chars(code), {}, 0); }};
   gate.awaitStarted(before + 1);
   // The block stores the code: the compile in flight is now one that a
   // block needs, and has no bound.
   CHECK_NOTHROW(writer.put(psibase::DbId::native, code));
   CHECK(writer.stored(psibase::DbId::native, code));
   // The run is given up when its own wait has passed. The compile is not.
   speculative.join();
   REQUIRE(run.has_value());
   CHECK(run->start == Start::started);
   const bool lifted = run->wait == Wait::inFlight;
   if (!lifted)
      CHECK(run->wait == Wait::abandoned);
   CHECK_FALSE(fixture.cache.awaitCompile(hash, {}, 0, std::chrono::nanoseconds(0)));
   psibase::CodeRow row{.codeNum = account, .codeHash = hash};
   fixture.block.db.kvPut(row.db, row.key(), row);
   gate.release();
   CHECK(NativeService::value(fixture.called(writer.transaction, account)) == 8);
   CHECK(fixture.cache.contains(hash, {}, 0));
   CHECK(writer.compiled() == 1);
   CHECK_FALSE(gate.compiledHere(before));
   CHECK(fixture.cache.stats().compilesAbandoned == (lifted ? 0u : 1u));
   CHECK(gate.count() == before + (lifted ? 1u : 2u));
}

TEST_CASE("A node that stops abandons the compiles speculative runs are waiting for", "[limits]")
{
   if (!isWasmtime())
      SKIP("only the wasmtime engine's compiler can be stopped");
   using namespace std::chrono;
   using Start = psibase::WasmCache::CompileStart;
   using Wait  = psibase::WasmCache::CompileWait;
   // Compiling needs no chain: the node's cache over the engine's, which
   // the test keeps to ask it afterwards what it did.
   NativeService registersHostFunctions;
   const auto    code = slowToCompile();
   const auto    hash = CodeWriter::row(code).codeHash;
   auto          stored = std::make_shared<RecordedArtifacts>();
   auto          engine = psibase::vm::selected().makeCache(4, recording(stored));
   std::promise<void> inCompiler;
   engine->compileHook = [&](const psibase::Checksum256&) { inCompiler.set_value(); };
   std::optional<psibase::WasmCache> cache{std::in_place, psibase::vm::selected(), engine};
   // A bound that does not pass: only the node stopping ends this compile.
   cache->setSpeculativeCompileWait(hours(1));
   std::optional<psibase::WasmCache::SpeculativeCompile> run;
   std::thread speculative{[&, waiting = *cache]() mutable
                           { run = waiting.compileForSpeculativeRun(hash, chars(code), {}, 0); }};
   // The compile thread is about to enter the compiler, where this module
   // keeps it for a couple of hundred milliseconds at least; a moment later
   // it is at work there.
   inCompiler.get_future().wait();
   std::this_thread::sleep_for(milliseconds(10));
   const auto stop = steady_clock::now();
   cache->abandonSpeculativeCompiles();
   // The run is given up at once, and with every copy of the cache gone
   // the compile thread is waited for: it returns instead of compiling on.
   speculative.join();
   cache.reset();
   const auto took = steady_clock::now() - stop;
   REQUIRE(run.has_value());
   CHECK(run->start == Start::started);
   CHECK(run->wait == Wait::abandoned);
   CHECK(took < seconds(5));
   const auto stats = engine->stats();
   CHECK(stats.compilesAbandoned == 1);
   CHECK(stats.compiled == 0);
   CHECK_FALSE(engine->contains(hash, {}, 0));
   CHECK_FALSE(engine->refused(hash, {}, 0));
   CHECK(stored->snapshot().empty());
}

TEST_CASE("A node that goes with a speculative run's compile in flight does not wait it out",
          "[limits]")
{
   if (!isWasmtime())
      SKIP("only the wasmtime engine's compiler can be stopped");
   using namespace std::chrono;
   using Start = psibase::WasmCache::CompileStart;
   using Wait  = psibase::WasmCache::CompileWait;
   // The cache is destroyed while a compile that a speculative run started
   // is in the compiler with no run waiting for it and no bound: a block
   // came to need it, and the run was given up when its own wait passed.
   // Nothing calls abandonSpeculativeCompiles; the last copy going is enough.
   NativeService registersHostFunctions;
   const auto    code   = slowToCompile();
   const auto    hash   = CodeWriter::row(code).codeHash;
   auto          stored = std::make_shared<RecordedArtifacts>();
   auto          engine = psibase::vm::selected().makeCache(4, recording(stored));
   CompileGate   gate;
   auto          release = psibase::finally{[&] { gate.release(); }};
   std::optional<psibase::WasmCache> cache{std::in_place, psibase::vm::selected(), engine};
   gate.attach(*cache);
   gate.close();
   // Long enough for the block's request below to come before it passes.
   cache->setSpeculativeCompileWait(seconds(2));
   std::optional<psibase::WasmCache::SpeculativeCompile> run;
   std::thread speculative{[&, waiting = *cache]() mutable
                           { run = waiting.compileForSpeculativeRun(hash, chars(code), {}, 0); }};
   gate.awaitStarted(1);
   CHECK(cache->compileInBackground(hash, chars(code), {}, 0) == Start::inFlight);
   speculative.join();
   REQUIRE(run.has_value());
   CHECK(run->start == Start::started);
   if (run->wait != Wait::inFlight)
   {
      // The machine kept this thread from asking for two seconds: the
      // compile was abandoned by its bound instead, which is not what this
      // test is about.
      CHECK(run->wait == Wait::abandoned);
      gate.release();
      cache->finishCompiles();
      SKIP("the bound passed before the block's request was made");
   }
   // The compile thread goes on into the compiler, and the node goes.
   gate.release();
   const auto stop = steady_clock::now();
   cache.reset();
   const auto took = steady_clock::now() - stop;
   CHECK(took < seconds(5));
   const auto stats = engine->stats();
   CHECK(stats.compilesAbandoned == 1);
   CHECK(stats.compiled == 0);
   CHECK_FALSE(engine->contains(hash, {}, 0));
   CHECK_FALSE(engine->refused(hash, {}, 0));
   CHECK(stored->snapshot().empty());
}
