#include <dlfcn.h>
#include <pthread.h>
#include <unistd.h>
#include <cerrno>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <psibase/storage.hpp>
#include <stdexcept>
#include <string>
#include <string_view>

namespace
{
   enum class Mode
   {
      healthy,
      writeEintr,
      shortWrite,
      fileSyncEintr,
      directorySyncEintr,
      zeroWrite,
      writeError,
      fileSyncError,
      directorySyncError
   };
   struct Fault
   {
      Mode     mode;
      int      descriptor = -1;
      bool     injected   = false;
      unsigned writes     = 0;
      unsigned syncs      = 0;
   };
   const pthread_t owner   = pthread_self();
   Fault*          current = nullptr;  // accessed only on owner; background I/O is untouched
   constexpr std::string_view identity = "psibase.psitri.big.manifest.v1\n";
   template <class Function>
   Function real(const char* name)
   {
      auto result = reinterpret_cast<Function>(dlsym(RTLD_NEXT, name));
      if (!result)
         std::_Exit(98);
      return result;
   }
   void require(bool value, const char* message)
   {
      if (!value)
         throw std::runtime_error(message);
   }
}  // namespace

extern "C" ssize_t write(int descriptor, const void* data, std::size_t size)
{
   static auto next = real<ssize_t (*)(int, const void*, std::size_t)>("write");
   if (!pthread_equal(owner, pthread_self()) || !current)
      return next(descriptor, data, size);
   auto& fault = *current;
   if (fault.descriptor == -1 && size == identity.size() &&
       std::string_view(static_cast<const char*>(data), size) == identity)
      fault.descriptor = descriptor;
   if (descriptor != fault.descriptor)
      return next(descriptor, data, size);
   ++fault.writes;
   if (!fault.injected)
   {
      switch (fault.mode)
      {
         case Mode::writeEintr:
         case Mode::writeError:
            fault.injected = true;
            errno          = fault.mode == Mode::writeEintr ? EINTR : EIO;
            return -1;
         case Mode::shortWrite:
            fault.injected = true;
            return next(descriptor, data, size / 2);
         case Mode::zeroWrite:
            fault.injected = true;
            return 0;
         default:
            break;
      }
   }
   return next(descriptor, data, size);
}

extern "C" int fsync(int descriptor)
{
   static auto next = real<int (*)(int)>("fsync");
   if (!pthread_equal(owner, pthread_self()) || !current || current->descriptor == -1)
      return next(descriptor);
   auto& fault = *current;
   ++fault.syncs;
   const bool file      = fault.syncs == 1;
   const bool directory = fault.syncs == 2;
   if (!fault.injected &&
       ((file && (fault.mode == Mode::fileSyncEintr || fault.mode == Mode::fileSyncError)) ||
        (directory &&
         (fault.mode == Mode::directorySyncEintr || fault.mode == Mode::directorySyncError))))
   {
      fault.injected = true;
      errno =
          fault.mode == Mode::fileSyncEintr || fault.mode == Mode::directorySyncEintr ? EINTR : EIO;
      return -1;
   }
   return next(descriptor);
}

int main(int argc, char** argv)
{
   try
   {
      require(argc == 2, "expected isolated fixture directory");
      const std::filesystem::path root = argv[1];
      std::filesystem::remove_all(root);
      const Mode modes[] = {
          Mode::healthy,       Mode::writeEintr,         Mode::shortWrite,
          Mode::fileSyncEintr, Mode::directorySyncEintr, Mode::zeroWrite,
          Mode::writeError,    Mode::fileSyncError,      Mode::directorySyncError};
      unsigned index = 0;
      for (auto mode : modes)
      {
         auto                                        path = root / std::to_string(index++);
         Fault                                       fault{mode};
         bool                                        accepted     = false;
         const bool                                  shouldReject = mode >= Mode::zeroWrite;
         std::unique_ptr<psibase::storage::database> database;
         current = &fault;
         try
         {
            database = std::make_unique<psibase::storage::database>(
                path, psibase::storage::database_config{1, 1, 1, 1},
                psibase::storage::open_mode::create_new);
            accepted = true;
         }
         catch (const std::runtime_error&)
         {
            if (!shouldReject)
               throw;
         }
         current = nullptr;
         require(accepted != shouldReject, "initialization accepted/rejected incorrectly");
         require(mode == Mode::healthy || fault.injected, "injection did not reach identity I/O");
         if (accepted)
         {
            const unsigned writes = mode == Mode::writeEintr || mode == Mode::shortWrite ? 2 : 1;
            const unsigned syncs =
                mode == Mode::fileSyncEintr || mode == Mode::directorySyncEintr ? 3 : 2;
            require(fault.writes == writes && fault.syncs == syncs, "unexpected retry count");
            std::ifstream file(path / "psibase-storage-format");
            require(std::string(std::istreambuf_iterator<char>(file), {}) == identity,
                    "initialization persisted a partial identity");
            database.reset();
            psibase::storage::database reopened(path, {1, 1, 1, 1},
                                                psibase::storage::open_mode::read_only);
            require(reopened.read_only(), "read-only reopen failed");
         }
         std::cout << "identity mode=" << unsigned(mode) << " accepted=" << accepted
                   << " writes=" << fault.writes << " syncs=" << fault.syncs << '\n';
      }
      for (auto mode :
           {Mode::zeroWrite, Mode::writeError, Mode::fileSyncError, Mode::directorySyncError})
      {
         const auto parent = root / ("temporary-" + std::to_string(unsigned(mode)));
         std::filesystem::create_directory(parent);
         std::ofstream(parent / "preserved") << "another owner's data";
         Fault fault{mode};
         bool  rejected = false;
         current        = &fault;
         try
         {
            psibase::storage::database temporary(parent, {1, 1, 1, 1},
                                                 psibase::storage::open_mode::temporary);
         }
         catch (const std::runtime_error&)
         {
            rejected = true;
         }
         current = nullptr;
         require(rejected && fault.injected, "temporary identity failure was not rejected");
         require(std::distance(std::filesystem::directory_iterator(parent),
                               std::filesystem::directory_iterator{}) == 1,
                 "failed temporary initialization leaked its owned directory");
         std::ifstream preserved(parent / "preserved");
         require(
             std::string(std::istreambuf_iterator<char>(preserved), {}) == "another owner's data",
             "temporary cleanup removed unrelated data");
      }
      std::cout << "identity initialization: 9 cases passed\n";
      std::cout << "temporary initialization cleanup: 4 terminal I/O failures passed\n";
   }
   catch (const std::exception& error)
   {
      current = nullptr;
      std::cerr << error.what() << '\n';
      return 1;
   }
}
