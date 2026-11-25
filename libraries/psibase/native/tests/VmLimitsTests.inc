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
               body.insert(body.end(), {0x70, 0});
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
   // Typed function references in declarations (off; see NativeVMOptions).
   {
      ServiceModule m;
      m.addFunction(m.addType({0x64, 0x70}, {}), {0, 0x0b});
      refused(m.build(), "typed function references");
   }
   refused(function({1, 1, 0x63, 0x70, 0x0b}), "typed function references");
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
