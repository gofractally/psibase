#include <psibase/NativeAotCache.hpp>

#include <fcntl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <atomic>
#include <cerrno>
#include <cstdio>

// Only the standalone filesystem test target enables deterministic short-I/O
// injection. Production uses the POSIX calls directly.
#ifdef PSIBASE_NATIVE_AOT_CACHE_TEST_IO
namespace psibase::native_aot_cache_test
{
   ssize_t read(int, void*, std::size_t);
   ssize_t write(int, const void*, std::size_t);
}  // namespace psibase::native_aot_cache_test
#endif

namespace psibase
{
   namespace
   {
      struct Fd
      {
         int value = -1;
         explicit Fd(int value = -1) : value(value) {}
         ~Fd()
         {
            if (value != -1)
               ::close(value);
         }
         Fd(const Fd&)            = delete;
         Fd& operator=(const Fd&) = delete;
         int release() noexcept
         {
            int result = value;
            value      = -1;
            return result;
         }
      };

      struct TempFile
      {
         int         directory;
         const char* name;
         ~TempFile() { ::unlinkat(directory, name, 0); }
      };

      bool privateDirectory(int fd) noexcept
      {
         struct stat st;
         return fd != -1 && ::fstat(fd, &st) == 0 && S_ISDIR(st.st_mode) &&
                st.st_uid == ::getuid() && (st.st_mode & 07777) == 0700;
      }

      bool privateFile(const struct stat& st) noexcept
      {
         return S_ISREG(st.st_mode) && st.st_uid == ::getuid() && (st.st_mode & 07777) == 0600 &&
                st.st_nlink == 1 && st.st_size > 0 &&
                static_cast<std::uintmax_t>(st.st_size) <= NativeAotDirectory::maxRecordSize;
      }

      bool unchanged(const struct stat& first, const struct stat& last) noexcept
      {
         if (first.st_dev != last.st_dev || first.st_ino != last.st_ino ||
             first.st_size != last.st_size)
            return false;
#ifdef __APPLE__
         return first.st_mtimespec.tv_sec == last.st_mtimespec.tv_sec &&
                first.st_mtimespec.tv_nsec == last.st_mtimespec.tv_nsec &&
                first.st_ctimespec.tv_sec == last.st_ctimespec.tv_sec &&
                first.st_ctimespec.tv_nsec == last.st_ctimespec.tv_nsec;
#else
         return first.st_mtim.tv_sec == last.st_mtim.tv_sec &&
                first.st_mtim.tv_nsec == last.st_mtim.tv_nsec &&
                first.st_ctim.tv_sec == last.st_ctim.tv_sec &&
                first.st_ctim.tv_nsec == last.st_ctim.tv_nsec;
#endif
      }

      void filename(const NativeArtifactStore::Key& key, char (&name)[70]) noexcept
      {
         constexpr char hex[] = "0123456789abcdef";
         for (std::size_t i = 0; i < key.size(); ++i)
         {
            name[2 * i]     = hex[key[i] >> 4];
            name[2 * i + 1] = hex[key[i] & 15];
         }
         const char suffix[] = ".pzam";
         for (std::size_t i = 0; i < sizeof(suffix); ++i)
            name[64 + i] = suffix[i];
      }

      ssize_t readFile(int fd, void* buffer, std::size_t size) noexcept
      {
#ifdef PSIBASE_NATIVE_AOT_CACHE_TEST_IO
         return native_aot_cache_test::read(fd, buffer, size);
#else
         return ::read(fd, buffer, size);
#endif
      }

      ssize_t writeFile(int fd, const void* buffer, std::size_t size) noexcept
      {
#ifdef PSIBASE_NATIVE_AOT_CACHE_TEST_IO
         return native_aot_cache_test::write(fd, buffer, size);
#else
         return ::write(fd, buffer, size);
#endif
      }
   }  // namespace

   NativeAotDirectory::NativeAotDirectory(const std::filesystem::path& requested) noexcept
   {
      try
      {
         if (requested.empty())
            return;
         const std::filesystem::path path = std::filesystem::absolute(requested);
         Fd current(::open(path.is_absolute() ? "/" : ".",
                           O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
         if (current.value == -1)
            return;
         // Walk each component so an intermediate symlink cannot redirect the
         // cache. Existing parents may have ordinary home-directory permissions.
         for (const auto& part : path)
         {
            if (part == "/" || part == ".")
               continue;
            if (part == "..")
               return;
            Fd next(::openat(current.value, part.c_str(),
                             O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
            // A link only the system can have made is followed: macOS reaches
            // its temporary directories through /tmp and /var, and refusing
            // those left every node under them without a cache, recompiling
            // each module on every start. A link owned by anyone else is still
            // refused, so no user can redirect the cache.
            struct stat link;
            if (next.value == -1 &&
                ::fstatat(current.value, part.c_str(), &link, AT_SYMLINK_NOFOLLOW) == 0 &&
                S_ISLNK(link.st_mode) && link.st_uid == 0)
               next.value = ::openat(current.value, part.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
            else if (next.value == -1 && errno == ENOENT)
            {
               if (::mkdirat(current.value, part.c_str(), 0700) == -1 && errno != EEXIST)
                  return;
               next.value = ::openat(current.value, part.c_str(),
                                     O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            }
            if (next.value == -1)
               return;
            ::close(current.value);
            current.value = next.release();
         }
         if (privateDirectory(current.value))
            directory = current.release();
      }
      catch (...)
      {
         // Caching cannot prevent VM execution, including allocation failures.
      }
   }

   NativeAotDirectory::~NativeAotDirectory()
   {
      if (directory != -1)
         ::close(directory);
   }

   bool NativeAotDirectory::usable() const noexcept
   {
      return privateDirectory(directory);
   }

   std::optional<std::vector<char>> NativeAotDirectory::read(const Key& key) noexcept
   {
      try
      {
         if (!usable())
            return std::nullopt;
         char name[70];
         filename(key, name);
         // O_NONBLOCK prevents a substituted FIFO from blocking before fstat.
         Fd          fd(::openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK));
         struct stat before;
         if (fd.value == -1 || ::fstat(fd.value, &before) == -1 || !privateFile(before))
            return std::nullopt;
         std::vector<char> bytes(static_cast<std::size_t>(before.st_size));
         std::size_t       offset = 0;
         while (offset < bytes.size())
         {
            auto count = readFile(fd.value, bytes.data() + offset, bytes.size() - offset);
            if (count < 0 && errno == EINTR)
               continue;
            if (count <= 0)
               return std::nullopt;
            offset += static_cast<std::size_t>(count);
         }
         char    extra;
         ssize_t count;
         do
            count = readFile(fd.value, &extra, 1);
         while (count < 0 && errno == EINTR);
         struct stat after;
         if (count != 0 || ::fstat(fd.value, &after) == -1 || !privateFile(after) ||
             !unchanged(before, after) || !usable())
            return std::nullopt;
         return bytes;
      }
      catch (...)
      {
         return std::nullopt;
      }
   }

   void NativeAotDirectory::write(const Key& key, std::span<const char> artifact) noexcept
   {
      try
      {
         if (!usable() || artifact.empty() || artifact.size() > maxRecordSize)
            return;
         char name[70];
         filename(key, name);
         static std::atomic<std::uint64_t> sequence{0};
         struct timespec                   now{};
         ::clock_gettime(CLOCK_MONOTONIC, &now);
         char temporary[160];
         Fd   fd;
         for (unsigned attempt = 0; attempt < 16; ++attempt)
         {
            std::snprintf(temporary, sizeof(temporary), ".%s.tmp.%ld.%llx.%llx", name,
                          static_cast<long>(::getpid()),
                          static_cast<unsigned long long>(now.tv_sec) * 1000000000ull +
                              static_cast<unsigned long long>(now.tv_nsec),
                          static_cast<unsigned long long>(sequence.fetch_add(1)));
            fd.value = ::openat(directory, temporary,
                                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
            if (fd.value != -1)
               break;
            if (errno != EEXIST)
               return;
         }
         if (fd.value == -1)
            return;
         TempFile cleanup{directory, temporary};
         // A restrictive umask can remove owner bits. Only our new O_EXCL file
         // is adjusted; existing entries and directories are never chmodded.
         if (::fchmod(fd.value, 0600) == -1)
            return;
         std::size_t offset = 0;
         while (offset < artifact.size())
         {
            auto count = writeFile(fd.value, artifact.data() + offset, artifact.size() - offset);
            if (count < 0 && errno == EINTR)
               continue;
            if (count <= 0)
               return;
            offset += static_cast<std::size_t>(count);
         }
         struct stat st;
         if (::fsync(fd.value) == -1 || ::fstat(fd.value, &st) == -1 || !privateFile(st) ||
             static_cast<std::size_t>(st.st_size) != artifact.size() || !usable())
            return;
         if (::renameat(directory, temporary, directory, name) == -1)
            return;
         // The entry is already complete and visible; directory fsync failure
         // only means this rebuildable cache entry may disappear after a crash.
         ::fsync(directory);
      }
      catch (...)
      {
      }
   }

   void NativeAotDirectory::erase(const Key& key) noexcept
   {
      if (!usable())
         return;
      char name[70];
      filename(key, name);
      ::unlinkat(directory, name, 0);
   }
}  // namespace psibase
