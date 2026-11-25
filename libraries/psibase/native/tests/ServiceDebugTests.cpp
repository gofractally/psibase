// Service debugging on the wasmtime engine (vm::serviceDebugging): what it
// gives a developer, and that it changes nothing a chain computes.

#include <boost/log/core.hpp>
#include <boost/log/sinks/sync_frontend.hpp>
#include <boost/log/sinks/text_ostream_backend.hpp>
#include <boost/smart_ptr/make_shared.hpp>
#include <catch2/catch_all.hpp>
#include <psibase/BlockContext.hpp>
#include <psibase/Prover.hpp>
#include <psibase/Socket.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/VmEngine.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/json.hpp>
#include <psio/pssz.hpp>
#include <psizam/utils.hpp>

#include <regex>
#include <set>
#include <sstream>
#include "TempDirectory.hpp"
#include "VmConsensusReplay.hpp"

// The GDB JIT interface, through which compiled code is handed to gdb and lldb.
// Whichever engine supports debugging defines the descriptor.
extern "C"
{
   struct jit_code_entry
   {
      jit_code_entry* next_entry;
      jit_code_entry* prev_entry;
      const char*     symfile_addr;
      uint64_t        symfile_size;
   };
   struct jit_descriptor
   {
      uint32_t        version;
      uint32_t        action_flag;
      jit_code_entry* relevant_entry;
      jit_code_entry* first_entry;
   };
   extern jit_descriptor __jit_debug_descriptor;
}

namespace
{
   using namespace psibase;
   namespace replay = psibase::vm_consensus_replay;

   // The transaction service of a chain. Both do what `Mode` says. The first
   // is assembled from psizam-debug-service.wat and has function names only.
   // The second is compiled from C with DWARF, and deployed under the VM
   // version whose code the engine compiles as deployed, so that the DWARF
   // still describes it.
   enum class Service
   {
      names,
      dwarf,
   };
   // As its DWARF names the source: the compilation directory and the file.
   const char* const dwarfSource = "./psizam-debug-dwarf-service.c";
   // Lines of psizam-debug-dwarf-service.c.
   constexpr int recurseLine = 73, abortLine = 84, divideLine = 91, callPeerLine = 93,
                 middleLine = 104, outerLine = 110, entryLine = 117;

   // What a fixture service does; see psizam-debug-service.wat.
   enum Mode : char
   {
      write = 1,
      unreachable,
      abort,
      recurse,
      spin,
      divideByZero,
      integerOverflow,
      memoryOutOfBounds,
      badConversion,
      nullIndirectCall,
      tableOutOfBounds,
      badSignature,
      peerAborts,
      peerWrites,
   };

   struct NullProver : Prover
   {
      std::vector<char> prove(std::span<const char>, const Claim&) const override { return {}; }
      bool              remove(const Claim&) override { return false; }
      void              get(std::vector<Claim>&) const override {}
      void              get(std::vector<ClaimKey>&) const override {}
   };

   // The node's setting, for as long as a chain is being made.
   struct ServiceDebugging
   {
      bool previous = vm::serviceDebugging();
      explicit ServiceDebugging(bool enabled) { vm::setServiceDebugging(enabled); }
      ~ServiceDebugging() { vm::setServiceDebugging(previous); }
   };

   std::set<const jit_code_entry*> registeredImages()
   {
      std::set<const jit_code_entry*> result;
      for (auto* entry = __jit_debug_descriptor.first_entry; entry; entry = entry->next_entry)
         result.insert(entry);
      return result;
   }

   // The images registered since `before` that contain `name`.
   std::size_t newImagesNaming(const std::set<const jit_code_entry*>& before, std::string_view name)
   {
      std::size_t result = 0;
      for (auto* entry = __jit_debug_descriptor.first_entry; entry; entry = entry->next_entry)
         if (!before.contains(entry) &&
             std::string_view(entry->symfile_addr, entry->symfile_size).find(name) !=
                 std::string_view::npos)
            ++result;
      return result;
   }

   // Everything the node logs while this exists.
   struct LogCapture
   {
      using Sink = boost::log::sinks::synchronous_sink<boost::log::sinks::text_ostream_backend>;
      boost::shared_ptr<std::ostringstream> stream = boost::make_shared<std::ostringstream>();
      boost::shared_ptr<Sink>               sink   = boost::make_shared<Sink>();
      LogCapture()
      {
         sink->locked_backend()->add_stream(stream);
         boost::log::core::get()->add_sink(sink);
      }
      ~LogCapture() { boost::log::core::get()->remove_sink(sink); }
      std::string text() const
      {
         sink->flush();
         return stream->str();
      }
   };

   void normalizeTiming(ActionTrace& action)
   {
      action.totalTime = {};
      for (auto& trace : action.innerTraces)
         if (auto* child = std::get_if<ActionTrace>(&trace.inner))
            normalizeTiming(*child);
   }

   // A chain whose transaction service is the fixture service, on a node
   // with service debugging on or off. Blocks are produced the way the node
   // produces them: the genesis block installs the services, and each later
   // transaction is pushed through BlockContext into the transaction
   // service's processTransaction.
   struct Chain
   {
      ServiceDebugging      mode;
      TempDirectory         directory;
      SharedDatabase        database{directory.path / "db",
                                     {64ull << 20, 64ull << 20, 64ull << 20, 64ull << 20}};
      WasmCache             cache;
      SystemContext         system{database,
                                   cache,
                                   {},
                                   std::make_shared<WatchdogManager>(),
                                   std::make_shared<Sockets>(database)};
      WriterPtr             writer = database.createWriter();
      AccountNumber         peer{"debug-peer"};
      std::optional<BlockContext> block;
      // Of every transaction pushed, with the observed times zeroed: they are
      // the only part of a trace that is not a result.
      std::vector<TransactionTrace> traces;
      std::vector<Checksum256>      blockIds;

      explicit Chain(bool                         debugging,
                     Service                      transact  = Service::names,
                     const std::filesystem::path& artifacts = {})
          : mode(debugging), cache(16, artifacts)
      {
         static const bool registered = []
         {
            ExecutionContext::registerHostFunctions();
            return true;
         }();
         (void)registered;

         // The peer is always the service with names only.
         auto names = psizam::read_wasm(PSIBASE_PSIZAM_DEBUG_SERVICE_WASM);
         auto code  = transact == Service::names
                          ? names
                          : psizam::read_wasm(PSIBASE_PSIZAM_DEBUG_DWARF_SERVICE_WASM);
         // The actions the service sends its peer, as the SDK serializes them.
         auto patch = [&](std::string_view marker, Mode mode, char argument)
         {
            auto nested = psio::to_pssz(Action{.sender  = transactionServiceNum,
                                               .service = peer,
                                               .rawData = marked(mode, argument)});
            auto slot = std::search(code.begin(), code.end(), marker.begin(), marker.end());
            REQUIRE(slot != code.end());
            REQUIRE(nested.size() + 4 <= 64);
            std::fill_n(slot, 64, 0);
            auto size = static_cast<std::uint32_t>(nested.size());
            std::memcpy(std::addressof(*slot), &size, sizeof(size));
            std::memcpy(std::addressof(*(slot + 4)), nested.data(), nested.size());
         };
         patch("DEBUG_PEER_ABORT_ACTION", Mode::abort, 0);
         patch("DEBUG_PEER_WRITE_ACTION", Mode::write, 'p');

         GenesisActionData genesis;
         auto              install =
             [&](AccountNumber account, std::uint8_t vmVersion, const std::vector<std::uint8_t>& code)
         {
            genesis.services.push_back(
                {.service   = account,
                 .flags     = CodeRow::isPrivileged,
                 .vmVersion = vmVersion,
                 .code      = {reinterpret_cast<const char*>(code.data()),
                               reinterpret_cast<const char*>(code.data()) + code.size()}});
         };
         install(transactionServiceNum, transact == Service::dwarf ? 1 : 0, code);
         install(peer, 0, names);
         startBlock();
         Transaction transaction;
         transaction.actions.push_back(Action{.rawData = psio::to_pssz(genesis)});
         REQUIRE_FALSE(push(std::move(transaction)).error.has_value());
         finishBlock();
      }

      static std::vector<char> marked(Mode mode, char argument)
      {
         return {'#', '#', '#', '#', mode, argument};
      }

      void startBlock()
      {
         block.emplace(system, database.getHead(), writer, true);
         block->start();
         block->callStartBlock();
      }

      void finishBlock()
      {
         auto [revision, id] = block->writeRevision(NullProver{}, Claim{});
         database.setHead(*writer, revision);
         blockIds.push_back(id);
         block.reset();
      }

      const TransactionTrace& push(Transaction                              transaction,
                                   std::optional<std::chrono::microseconds> limit = {})
      {
         SignedTransaction signedTransaction;
         signedTransaction.transaction = psio::shared_pssz<Transaction>{transaction};
         TransactionTrace trace;
         try
         {
            block->pushTransaction(std::move(signedTransaction), trace, limit, true, true);
         }
         catch (const std::exception&)
         {
            // A failed transaction is not in the block; its trace says why.
         }
         for (auto& action : trace.actionTraces)
            normalizeTiming(action);
         return traces.emplace_back(std::move(trace));
      }

      const TransactionTrace& push(Mode                                     mode,
                                   char                                     argument = 0,
                                   std::optional<std::chrono::microseconds> limit    = {})
      {
         Transaction transaction;
         transaction.actions.push_back(Action{.rawData = marked(mode, argument)});
         return push(std::move(transaction), limit);
      }

      // Every objective row of the head state.
      std::string state()
      {
         auto file = directory.path / "state.rows";
         replay::snapshot(database, database.getHead(), file, false);
         return replay::fileHash(file);
      }
   };

   std::string error(const TransactionTrace& trace)
   {
      return trace.error.value_or("");
   }

   const char* const transactAborted =
       "service 'transact' aborted with message: debug fixture abort";
   const char* const peerAborted =
       "service 'debug-peer' aborted with message: debug fixture abort";

   // The trace of the one call `action` made to `service`.
   const ActionTrace& callTo(const ActionTrace& action, AccountNumber service)
   {
      const ActionTrace* result = nullptr;
      for (auto& inner : action.innerTraces)
         if (auto* call = std::get_if<ActionTrace>(&inner.inner))
            if (call->action.service == service)
            {
               REQUIRE(result == nullptr);
               result = call;
            }
      REQUIRE(result != nullptr);
      return *result;
   }

   // The trace of the transaction service's action.
   const ActionTrace& top(const TransactionTrace& trace)
   {
      REQUIRE(trace.actionTraces.size() == 1);
      return trace.actionTraces.front();
   }

   const std::initializer_list<Mode> traps = {
       Mode::unreachable,      Mode::divideByZero,     Mode::integerOverflow,
       Mode::memoryOutOfBounds, Mode::badConversion,   Mode::nullIndirectCall,
       Mode::tableOutOfBounds, Mode::badSignature};

   // Two blocks of transactions that succeed and fail in every way the
   // fixture service knows.
   void runBlocks(Chain& chain)
   {
      using namespace std::chrono_literals;
      chain.startBlock();
      chain.push(Mode::write, 'a');
      chain.push(Mode::abort);
      chain.push(Mode::recurse);
      chain.push(Mode::spin, 0, 20ms);
      for (auto trap : traps)
         chain.push(trap);
      chain.push(Mode::peerAborts);
      chain.push(Mode::peerWrites, 'b');
      chain.push(Mode::write, 'c');
      chain.finishBlock();
      chain.startBlock();
      chain.push(Mode::write, 'a');
      chain.push(Mode::recurse);
      chain.push(Mode::peerWrites, 'd');
      chain.finishBlock();
   }
}  // namespace

TEST_CASE("The default engine can debug services")
{
   // The option is off unless the node's operator turns it on.
   REQUIRE_FALSE(vm::serviceDebugging());
   // A node asked to debug refuses to start on an engine that cannot, so this
   // also fails if the default engine loses its debugging support.
   REQUIRE(vm::selected().serviceDebugging);
   REQUIRE(__jit_debug_descriptor.version == 1);

   const auto before = registeredImages();
   {
      Chain chain(false);
      chain.startBlock();
      CHECK(error(chain.push(Mode::write, 'a')) == "");
      // Off: nothing is handed to a debugger.
      CHECK(registeredImages() == before);
   }
   {
      Chain chain(true);
      chain.startBlock();
      CHECK(error(chain.push(Mode::write, 'a')) == "");
      // On: the compiled service is on the debugger's list, as an image whose
      // symbols name the service's functions.
      CHECK(newImagesNaming(before, "debug_inner") >= 1);
      CHECK(newImagesNaming(before, "debug_outer") >= 1);
      // A setting changed later does not reach a chain that is running.
      vm::setServiceDebugging(false);
      CHECK(error(chain.push(Mode::write, 'b')) == "");
      CHECK(newImagesNaming(before, "debug_inner") >= 1);
   }
   // The images go when the services compiled for debugging do.
   CHECK(registeredImages() == before);
   {
      // A service with DWARF is handed over with it: line tables, and the
      // name of its source file.
      Chain chain(true, Service::dwarf);
      chain.startBlock();
      CHECK(error(chain.push(Mode::write, 'a')) == "");
      CHECK(newImagesNaming(before, "debug_middle") >= 1);
      CHECK(newImagesNaming(before, ".debug_line") >= 1);
      CHECK(newImagesNaming(before, "psizam-debug-dwarf-service.c") >= 1);
   }
   {
      Chain chain(false, Service::dwarf);
      chain.startBlock();
      CHECK(error(chain.push(Mode::write, 'a')) == "");
      CHECK(registeredImages() == before);
   }
}

TEST_CASE("A node that debugs services computes what a node that does not computes")
{
   auto service = GENERATE(Service::names, Service::dwarf);
   INFO("transaction service " << (service == Service::names ? "with names" : "with DWARF"));
   Chain plain(false, service);
   runBlocks(plain);
   Chain debugging(true, service);
   runBlocks(debugging);

   // What the transactions did, so that equal results are not equal failures
   // to run anything.
   auto step = plain.traces.begin() + 1;  // after the genesis transaction
   CHECK(error(*step) == "");
   CHECK(top(*step++).rawRetval == std::vector<char>{'a', 0, 0, 0});
   CHECK(error(*step++) == transactAborted);
   // The stack budget runs out in the transaction service's own call.
   CHECK(error(*step) == "stack overflow");
   CHECK(top(*step).error == "stack overflow");
   CHECK(top(*step++).innerTraces.empty());
   CHECK(error(*step++) == "transaction timed out");
   for (auto trap : traps)
   {
      INFO("trap mode " << int(trap));
      // The C service has two of the traps and does nothing for the others.
      if (service == Service::names || trap == Mode::unreachable || trap == Mode::divideByZero)
         CHECK_THAT(error(*step), Catch::Matchers::ContainsSubstring("wasm trap: "));
      else
         CHECK(error(*step) == "");
      ++step;
   }
   // The peer's failure is the transaction's, recorded on the peer's action.
   CHECK(error(*step) == peerAborted);
   CHECK(callTo(top(*step++), plain.peer).error == std::optional<std::string>{peerAborted});
   CHECK(error(*step) == "");
   CHECK(callTo(top(*step++), plain.peer).rawRetval == std::vector<char>{'p', 0, 0, 0});

   REQUIRE(debugging.traces.size() == plain.traces.size());
   for (std::size_t i = 0; i < plain.traces.size(); ++i)
   {
      INFO("transaction " << i << " without debugging: " << psio::to_ijson(plain.traces[i]));
      INFO("transaction " << i << " with debugging: " << psio::to_ijson(debugging.traces[i]));
      CHECK(psio::to_pssz(debugging.traces[i]) == psio::to_pssz(plain.traces[i]));
   }
   // The block ids commit to the transactions each block took, and the rows
   // are the whole objective state.
   REQUIRE(plain.blockIds.size() == 3);
   CHECK(debugging.blockIds == plain.blockIds);
   CHECK(debugging.state() == plain.state());
}

TEST_CASE("A node that debugs services logs where a failed service was")
{
   // Function names, each "name (index) +offset", in the order logged.
   auto requireInOrder = [](const std::string& log, std::initializer_list<const char*> parts)
   {
      std::size_t at = 0;
      for (auto part : parts)
      {
         INFO("looking for " << part << " in: " << log);
         at = log.find(part, at);
         REQUIRE(at != std::string::npos);
      }
   };
   {
      Chain chain(true);
      chain.startBlock();
      {
         LogCapture log;
         const auto& trace = chain.push(Mode::abort);
         CHECK(error(trace) == transactAborted);
         // Innermost first, from the function that failed out to the entry.
         requireInOrder(log.text(), {"service transact failed here", "0: debug_inner (12) +0x",
                                     "1: debug_middle (13) +0x", "2: debug_outer (14) +0x",
                                     "3: processTransaction (16) +0x"});
         // The frames are for this node's developer only.
         CHECK(psio::to_ijson(trace).find("debug_") == std::string::npos);
      }
      {
         LogCapture log;
         // A trap says what it says on a node that does not debug.
         CHECK(error(chain.push(Mode::unreachable)) ==
               "wasm trap: wasm `unreachable` instruction executed");
         requireInOrder(log.text(), {"0: debug_inner (12) +0x", "1: debug_middle (13) +0x",
                                     "2: debug_outer (14) +0x", "3: processTransaction (16) +0x"});
      }
      {
         // Each service on the call path logs its own frames, the one that
         // failed first.
         LogCapture log;
         CHECK(error(chain.push(Mode::peerAborts)) == peerAborted);
         requireInOrder(log.text(),
                        {"service debug-peer failed here", "0: debug_inner (12) +0x",
                         "3: called (17) +0x", "service transact failed here",
                         "0: debug_inner (12) +0x", "3: processTransaction (16) +0x"});
      }
      {
         // A stack overflow is deep; the innermost frames are what is kept.
         LogCapture log;
         CHECK(error(chain.push(Mode::recurse)) == "stack overflow");
         requireInOrder(log.text(), {"0: debug_recurse (9) +0x", "1: debug_recurse (9) +0x",
                                     "(and 126 more of the same)", "(outer frames not shown)"});
      }
   }
   {
      // A service with DWARF: each frame also says where in the source it is.
      Chain chain(true, Service::dwarf);
      chain.startBlock();
      auto where = [](int line)
      { return " at " + std::string(dwarfSource) + ":" + std::to_string(line); };
      auto frame = [&](int index, const char* function, int line)
      {
         // "<index>: <function> (<wasm index>) +0x<offset> at <file>:<line>"
         return std::regex(std::to_string(index) + ": " + function +
                           " \\([0-9]+\\) \\+0x[0-9a-f]+ at \\./psizam-debug-dwarf-service\\.c:" +
                           std::to_string(line) + "\n");
      };
      auto requireFrames = [&](const std::string& log, const char* innermost, int line,
                               const char* entry = "processTransaction")
      {
         INFO(log);
         CHECK(std::regex_search(log, frame(0, innermost, line)));
         CHECK(std::regex_search(log, frame(1, "debug_middle", middleLine)));
         CHECK(std::regex_search(log, frame(2, "debug_outer", outerLine)));
         CHECK(log.find(std::string("3: ") + entry + " (") != std::string::npos);
      };
      {
         LogCapture  log;
         const auto& trace = chain.push(Mode::abort);
         CHECK(error(trace) == transactAborted);
         requireFrames(log.text() + "\n", "debug_inner", abortLine);
         CHECK(log.text().find("3: processTransaction") != std::string::npos);
         CHECK(log.text().find(where(entryLine)) != std::string::npos);
         CHECK(psio::to_ijson(trace).find(dwarfSource) == std::string::npos);
      }
      {
         LogCapture log;
         CHECK(error(chain.push(Mode::divideByZero)) == "wasm trap: integer divide by zero");
         requireFrames(log.text() + "\n", "debug_inner", divideLine);
      }
      {
         // The peer has no DWARF and logs names; the caller logs the line
         // of its call.
         LogCapture log;
         CHECK(error(chain.push(Mode::peerAborts)) == peerAborted);
         requireInOrder(log.text(), {"service debug-peer failed here", "0: debug_inner (12) +0x",
                                     "service transact failed here"});
         requireFrames(log.text() + "\n", "debug_inner", callPeerLine);
      }
      {
         LogCapture log;
         CHECK(error(chain.push(Mode::recurse)) == "stack overflow");
         INFO(log.text());
         CHECK(log.text().find("debug_recurse") != std::string::npos);
         CHECK(log.text().find(where(recurseLine)) != std::string::npos);
      }
   }
   {
      Chain      chain(false);
      LogCapture log;
      chain.startBlock();
      CHECK(error(chain.push(Mode::abort)) == transactAborted);
      CHECK(error(chain.push(Mode::unreachable)) ==
            "wasm trap: wasm `unreachable` instruction executed");
      CHECK(log.text().find("failed here") == std::string::npos);
      CHECK(log.text().find("debug_inner") == std::string::npos);
   }
}

TEST_CASE("Services compiled for debugging are stored apart from those that are not")
{
   TempDirectory artifacts;
   std::filesystem::permissions(artifacts.path, std::filesystem::perms::owner_all);
   auto stored = [&]
   {
      return std::distance(std::filesystem::recursive_directory_iterator(artifacts.path),
                           std::filesystem::recursive_directory_iterator());
   };
   const auto before = registeredImages();
   {
      Chain chain(true, Service::names, artifacts.path);
      chain.startBlock();
      CHECK(error(chain.push(Mode::write, 'a')) == "");
   }
   const auto debugged = stored();
   REQUIRE(debugged > 0);
   {
      // The same service, the same limits, the same directory: the node that
      // does not debug compiles its own code and keeps it next to the other.
      Chain chain(false, Service::names, artifacts.path);
      chain.startBlock();
      CHECK(error(chain.push(Mode::write, 'a')) == "");
      CHECK(registeredImages() == before);
   }
   CHECK(stored() == 2 * debugged);
   {
      // And a node that debugs gets the code compiled for debugging back.
      Chain chain(true, Service::names, artifacts.path);
      chain.startBlock();
      CHECK(error(chain.push(Mode::write, 'a')) == "");
      CHECK(newImagesNaming(before, "debug_inner") >= 1);
   }
   CHECK(stored() == 2 * debugged);
}
