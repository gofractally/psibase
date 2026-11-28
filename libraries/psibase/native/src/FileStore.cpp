#include <psibase/FileStore.hpp>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>

namespace psibase
{
   namespace
   {
      struct Fd
      {
         int fd = -1;
         ~Fd()
         {
            if (fd >= 0)
               ::close(fd);
         }
         explicit operator bool() const { return fd >= 0; }
      };
   }  // namespace

   FileStore::FileStore(std::filesystem::path root) : root_(std::move(root)) {}

   bool FileStore::validName(std::string_view name)
   {
      return !name.empty() && name.size() <= 128 &&
             std::ranges::all_of(
                 name, [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); });
   }

   std::filesystem::path FileStore::path(AccountNumber    service,
                                         std::string_view name,
                                         bool             pending) const
   {
      // Two characters of fan-out keep directories small.
      auto shard = name.substr(0, std::min<std::size_t>(2, name.size()));
      return root_ / service.str() / (pending ? "pending" : "files") / shard / name;
   }

   std::optional<std::uint64_t> FileStore::append(AccountNumber         service,
                                                  std::string_view      name,
                                                  std::span<const char> data)
   {
      if (!validName(name))
         return std::nullopt;
      auto            file = path(service, name, true);
      std::error_code ec;
      std::filesystem::create_directories(file.parent_path(), ec);
      if (ec)
         return std::nullopt;
      Fd fd{::open(file.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644)};
      if (!fd)
         return std::nullopt;
      const char* pos       = data.data();
      std::size_t remaining = data.size();
      while (remaining)
      {
         auto n = ::write(fd.fd, pos, remaining);
         if (n < 0)
         {
            if (errno == EINTR)
               continue;
            return std::nullopt;
         }
         pos += n;
         remaining -= static_cast<std::size_t>(n);
      }
      struct stat st;
      if (::fstat(fd.fd, &st) < 0)
         return std::nullopt;
      return static_cast<std::uint64_t>(st.st_size);
   }

   bool FileStore::commit(AccountNumber service, std::string_view pending, std::string_view final_)
   {
      if (!validName(pending) || !validName(final_))
         return false;
      auto from = path(service, pending, true);
      auto to   = path(service, final_, false);
      {
         // What was written has to be on disk before the name says it is there.
         Fd fd{::open(from.c_str(), O_RDONLY | O_CLOEXEC)};
         if (!fd)
            return false;
         if (::fsync(fd.fd) < 0)
            return false;
      }
      std::error_code ec;
      if (std::filesystem::exists(to, ec))
      {
         std::filesystem::remove(from, ec);
         return true;
      }
      std::filesystem::create_directories(to.parent_path(), ec);
      if (ec)
         return false;
      std::filesystem::rename(from, to, ec);
      return !ec;
   }

   bool FileStore::remove(AccountNumber service, std::string_view name, bool pending)
   {
      if (!validName(name))
         return false;
      std::error_code ec;
      return std::filesystem::remove(path(service, name, pending), ec) && !ec;
   }

   std::optional<std::uint64_t> FileStore::size(AccountNumber    service,
                                                std::string_view name,
                                                bool             pending)
   {
      if (!validName(name))
         return std::nullopt;
      struct stat st;
      if (::stat(path(service, name, pending).c_str(), &st) < 0 || !S_ISREG(st.st_mode))
         return std::nullopt;
      return static_cast<std::uint64_t>(st.st_size);
   }

   int FileStore::open(AccountNumber service, std::string_view name)
   {
      if (!validName(name))
         return -1;
      return ::open(path(service, name, false).c_str(), O_RDONLY | O_CLOEXEC);
   }

   std::optional<std::vector<char>> FileStore::read(AccountNumber    service,
                                                    std::string_view name,
                                                    std::uint64_t    offset,
                                                    std::size_t      length)
   {
      Fd fd{open(service, name)};
      if (!fd)
         return std::nullopt;
      struct stat st;
      if (::fstat(fd.fd, &st) < 0)
         return std::nullopt;
      auto total = static_cast<std::uint64_t>(st.st_size);
      if (offset > total)
         offset = total;
      length = static_cast<std::size_t>(std::min<std::uint64_t>(length, total - offset));
      std::vector<char> result(length);
      std::size_t       done = 0;
      while (done < length)
      {
         auto n = ::pread(fd.fd, result.data() + done, length - done,
                          static_cast<off_t>(offset + done));
         if (n < 0)
         {
            if (errno == EINTR)
               continue;
            return std::nullopt;
         }
         if (n == 0)
            break;
         done += static_cast<std::size_t>(n);
      }
      result.resize(done);
      return result;
   }
}  // namespace psibase
