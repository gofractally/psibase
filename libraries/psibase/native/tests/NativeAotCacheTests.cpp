#include <psibase/NativeAotCache.hpp>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>
#include <thread>

// Standalone target: compile this file and NativeAotCache.cpp with
// PSIBASE_NATIVE_AOT_CACHE_TEST_IO, using only the C++20/POSIX libraries.
namespace
{
   enum class Fault
   {
      none,
      shortIo,
      interrupted,
      eof,
      writeError
   };
   std::atomic<Fault>    fault{Fault::none};
   std::atomic<unsigned> readCalls{0}, writeCalls{0};

   void require(bool condition, const char* message)
   {
      if (!condition)
         throw std::runtime_error(message);
   }

   void inject(Fault value)
   {
      readCalls  = 0;
      writeCalls = 0;
      fault      = value;
   }

   struct TemporaryDirectory
   {
      std::filesystem::path path;
      TemporaryDirectory()
      {
         auto root = std::filesystem::canonical(std::filesystem::temp_directory_path());
         auto name = (root / "psibase-aot-cache-XXXXXX").string();
         require(::mkdtemp(name.data()) != nullptr, "mkdtemp");
         path = name;
      }
      ~TemporaryDirectory()
      {
         std::error_code ec;
         std::filesystem::remove_all(path, ec);
      }
   };

   psibase::NativeAotDirectory::Key key(unsigned value)
   {
      psibase::NativeAotDirectory::Key result{};
      result[0] = value;
      return result;
   }

   std::filesystem::path entry(const std::filesystem::path& directory, unsigned value)
   {
      char prefix[3];
      std::snprintf(prefix, sizeof(prefix), "%02x", value);
      return directory / (std::string(prefix) + std::string(62, '0') + ".pzam");
   }

   bool equals(const std::optional<std::vector<char>>& value, const std::vector<char>& expected)
   {
      return value && *value == expected;
   }

   void basics(const std::filesystem::path& root)
   {
      const auto              directory = root / "nested" / "cache";
      psibase::NativeAotDirectory cache(directory);
      require(cache.usable(), "created private cache");
      require(!cache.read(key(1)), "missing entry");
      const std::vector<char> original{'o', 'p', 'a', 'q', 'u', 'e'};
      cache.write(key(1), original);
      require(equals(cache.read(key(1)), original), "roundtrip opaque bytes");
      struct stat st;
      require(::stat(directory.c_str(), &st) == 0 && (st.st_mode & 07777) == 0700, "directory0700");
      require(::stat(entry(directory, 1).c_str(), &st) == 0 && (st.st_mode & 07777) == 0600 &&
                  st.st_uid == ::getuid() && st.st_nlink == 1,
              "owned private regular entry");
      psibase::NativeAotDirectory reopened(directory);
      require(equals(reopened.read(key(1)), original), "persistent second cache instance");
      cache.write(key(2), {});
      require(!cache.read(key(2)), "empty artifact not cached");
      require(!psibase::NativeAotDirectory({}).usable(), "empty path disabled");
      require(!psibase::NativeAotDirectory(root / ".." / "other").usable(),
              "parent traversal rejected");
   }

   void filesystemChecks(const std::filesystem::path& root)
   {
      const auto              directory = root / "checks";
      psibase::NativeAotDirectory cache(directory);
      const std::vector<char> bytes(64, 'x');
      cache.write(key(1), bytes);
      const auto file = entry(directory, 1);
      require(::chmod(file.c_str(), 0644) == 0, "chmod public file");
      require(!cache.read(key(1)), "public file refused");
      require(::chmod(file.c_str(), 0600) == 0, "restore file mode");
      const auto outside = root / "outside";
      require(::link(file.c_str(), outside.c_str()) == 0, "make hardlink");
      require(!cache.read(key(1)), "hardlinked file refused");
      require(::unlink(file.c_str()) == 0, "remove linked cache entry");
      require(::symlink(outside.c_str(), file.c_str()) == 0, "make entry symlink");
      require(!cache.read(key(1)), "symlink entry refused");
      cache.write(key(1), std::vector<char>(64, 'y'));
      require(equals(cache.read(key(1)), std::vector<char>(64, 'y')), "replace symlink safely");
      int fd = ::open(outside.c_str(), O_RDONLY);
      require(fd != -1, "open outside target");
      char value = 0;
      require(::read(fd, &value, 1) == 1 && value == 'x', "symlink target untouched");
      ::close(fd);

      require(::unlink(file.c_str()) == 0 && ::mkfifo(file.c_str(), 0600) == 0, "make FIFO entry");
      require(!cache.read(key(1)), "FIFO refused without blocking");
      require(::unlink(file.c_str()) == 0 && ::mkdir(file.c_str(), 0700) == 0,
              "make directory entry");
      require(!cache.read(key(1)), "directory file refused");
      require(::rmdir(file.c_str()) == 0, "remove directory entry");
      fd = ::open(file.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
      require(fd != -1, "make sparse oversized entry");
      require(::ftruncate(fd, psibase::NativeAotDirectory::maxRecordSize + 1) == 0,
              "sparse oversized size");
      ::close(fd);
      require(!cache.read(key(1)), "oversized entry refused");

      require(::chmod(directory.c_str(), 0755) == 0, "chmod public directory");
      require(!cache.usable() && !cache.read(key(1)), "changed directory mode disables cache");
      cache.write(key(2), bytes);
      require(!std::filesystem::exists(entry(directory, 2)), "insecure directory store skipped");
      require(!psibase::NativeAotDirectory(directory).usable(),
              "public existing directory refused");
      require(::chmod(directory.c_str(), 0700) == 0, "restore directory mode");
      require(::chmod(directory.c_str(), 0000) == 0, "chmod denied directory");
      require(!cache.read(key(1)), "permission failure is a miss");
      require(::chmod(directory.c_str(), 0700) == 0, "restore directory permissions");

      const auto alias = root / "alias";
      require(::symlink(directory.c_str(), alias.c_str()) == 0, "directory alias");
      require(!psibase::NativeAotDirectory(alias).usable(), "final symlink directory refused");
      require(!psibase::NativeAotDirectory(alias / "child").usable(), "parent symlink refused");
      require(!std::filesystem::exists(directory / "child"), "symlink parent not modified");
      require(!psibase::NativeAotDirectory(outside).usable(), "regular file directory refused");
      require(!psibase::NativeAotDirectory(root / std::string(300, 'x')).usable(),
              "path syscall error disabled");
      if (::geteuid() == 0)
      {
         cache.write(key(3), bytes);
         require(::chown(entry(directory, 3).c_str(), 1, -1) == 0, "change file owner");
         require(!cache.read(key(3)), "foreign-owned file refused");
         require(::chown(entry(directory, 3).c_str(), ::getuid(), -1) == 0, "restore file owner");
         require(::chown(directory.c_str(), 1, -1) == 0, "change directory owner");
         require(!cache.usable() && !psibase::NativeAotDirectory(directory).usable(),
                 "foreign-owned directory refused");
         require(::chown(directory.c_str(), ::getuid(), -1) == 0, "restore directory owner");
      }
   }

   void shortIo(const std::filesystem::path& root)
   {
      const auto              directory = root / "short-io";
      psibase::NativeAotDirectory cache(directory);
      const std::vector<char> before(128, 'a'), after(128, 'b');
      cache.write(key(1), before);
      inject(Fault::shortIo);
      require(equals(cache.read(key(1)), before), "short positive reads completed");
      cache.write(key(1), after);
      require(equals(cache.read(key(1)), after), "short positive writes completed");
      inject(Fault::eof);
      require(!cache.read(key(1)), "early EOF becomes miss");
      inject(Fault::writeError);
      cache.write(key(1), before);
      inject(Fault::none);
      require(equals(cache.read(key(1)), after), "failed store preserves previous entry");
      require(std::distance(std::filesystem::directory_iterator(directory),
                            std::filesystem::directory_iterator{}) == 1,
              "failed store removed temporary file");
      inject(Fault::interrupted);
      cache.write(key(1), before);
      require(equals(cache.read(key(1)), before), "EINTR read/write retried");
      inject(Fault::none);
   }

   void concurrent(const std::filesystem::path& root)
   {
      const auto              directory = root / "concurrent";
      psibase::NativeAotDirectory first(directory), second(directory);
      first.write(key(1), std::vector<char>(4096, '0'));
      std::atomic<bool>        failed{false};
      std::vector<std::thread> threads;
      for (unsigned worker = 0; worker < 8; ++worker)
         threads.emplace_back(
             [&, worker]
             {
                auto& cache = worker % 2 ? first : second;
                for (unsigned iteration = 0; iteration < 30; ++iteration)
                {
                   if (worker < 6)
                      cache.write(key(1), std::vector<char>(4096, char('a' + worker)));
                   if (auto value = cache.read(key(1));
                       value && (value->size() != 4096 ||
                                 !std::all_of(value->begin(), value->end(),
                                              [&](char c) { return c == (*value)[0]; })))
                      failed = true;
                }
             });
      for (auto& thread : threads)
         thread.join();
      require(!failed, "concurrent readers only see whole published artifacts");
      require(first.read(key(1)).has_value(), "complete final artifact");
      require(std::distance(std::filesystem::directory_iterator(directory),
                            std::filesystem::directory_iterator{}) == 1,
              "concurrent stores leave no temporary entries");
   }
}  // namespace

namespace psibase::native_aot_cache_test
{
   ssize_t read(int fd, void* buffer, std::size_t size)
   {
      const auto mode = fault.load();
      const auto call = readCalls.fetch_add(1);
      if (mode == Fault::interrupted && call == 0)
      {
         errno = EINTR;
         return -1;
      }
      if (mode == Fault::eof && call > 0)
         return 0;
      return ::read(
          fd, buffer,
          mode == Fault::shortIo || mode == Fault::eof ? std::min<std::size_t>(size, 7) : size);
   }

   ssize_t write(int fd, const void* buffer, std::size_t size)
   {
      const auto mode = fault.load();
      const auto call = writeCalls.fetch_add(1);
      if ((mode == Fault::interrupted && call == 0) || (mode == Fault::writeError && call > 0))
      {
         errno = mode == Fault::interrupted ? EINTR : ENOSPC;
         return -1;
      }
      return ::write(fd, buffer,
                     mode == Fault::shortIo || mode == Fault::writeError
                         ? std::min<std::size_t>(size, 7)
                         : size);
   }
}  // namespace psibase::native_aot_cache_test

int main()
{
   try
   {
      TemporaryDirectory directory;
      basics(directory.path);
      filesystemChecks(directory.path);
      shortIo(directory.path);
      concurrent(directory.path);
      std::puts(
          "Native AOT cache ownership, permissions, links, bounded I/O, faults and concurrency "
          "passed");
      return 0;
   }
   catch (const std::exception& e)
   {
      std::fprintf(stderr, "Native AOT cache failure: %s\n", e.what());
      return 1;
   }
}
