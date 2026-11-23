// Native-only glue: routes the service's raw host functions through a table
// the host installs. The service source (VerifySig.cpp) is compiled unchanged.
#include <cstdint>
#include <exception>
#include <string_view>

extern "C"
{
   struct psibase_host
   {
      void*    ctx;
      uint32_t (*getCurrentAction)(void* ctx);
      uint32_t (*getResult)(void* ctx, char* dest, uint32_t destSize, uint32_t offset);
      void (*writeConsole)(void* ctx, const char* message, uint32_t len);
      void (*abortMessage)(void* ctx, const char* message, uint32_t len);
   };
}

static thread_local const psibase_host* current_host = nullptr;

namespace
{
   struct service_abort
   {
   };
}  // namespace

namespace psibase::raw
{
   [[noreturn]] void abortMessage(const char* message, std::uint32_t len)
   {
      // Report the message, then unwind back to psibase_native_called. No
      // exception crosses the library boundary.
      current_host->abortMessage(current_host->ctx, message, len);
      throw service_abort{};
   }
   uint32_t getResult(const char* dest, uint32_t destSize, uint32_t offset)
   {
      return current_host->getResult(current_host->ctx, const_cast<char*>(dest), destSize, offset);
   }
   void writeConsole(const char* message, uint32_t len)
   {
      current_host->writeConsole(current_host->ctx, message, len);
   }
   uint32_t getCurrentAction()
   {
      return current_host->getCurrentAction(current_host->ctx);
   }
}  // namespace psibase::raw

namespace psibase
{
   struct AccountNumber;
}

// Defined by the service source.
extern "C" void prestart();
extern "C" void called(std::uint64_t thisService, std::uint64_t sender);

extern "C"
{
   __attribute__((visibility("default"))) void psibase_native_prestart()
   {
      prestart();
   }
   // Returns 0 on success, 1 if the service aborted, 2 on any other exception.
   __attribute__((visibility("default"))) int psibase_native_called(const psibase_host* host,
                                                                     std::uint64_t       service,
                                                                     std::uint64_t       sender)
   {
      auto prev    = current_host;
      current_host = host;
      int status   = 0;
      try
      {
         called(service, sender);
      }
      catch (const service_abort&)
      {
         status = 1;
      }
      catch (const std::exception& e)
      {
         // Outside wasm, psibase::check reports failure by throwing; the wasm
         // build aborts on any exception. Both become an abort here.
         std::string_view what = e.what();
         host->abortMessage(host->ctx, what.data(), what.size());
         status = 1;
      }
      catch (...)
      {
         status = 2;
      }
      current_host = prev;
      return status;
   }
}

// The wasm build runs static constructors from prestart(); natively the
// loader has already run them.
extern "C" void __wasm_call_ctors() {}
