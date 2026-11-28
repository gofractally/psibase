#pragma once

#include <psibase/AccountNumber.hpp>

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <string_view>
#include <vector>

namespace psibase
{
   /// Plain files that node-local services keep outside the database
   /// (gofractally/psibase#2312).
   ///
   /// A service sees only names. A name is 1 to 128 characters of a-z and
   /// 0-9, and names are scoped to the service: the node decides where a
   /// file is, so a service cannot name a path on the host. The directory
   /// may be local or a mounted object store shared by several nodes, so the
   /// only way to make a file is to write it front to back and then commit
   /// it; nothing is visible under its final name before that.
   ///
   /// This knows nothing about what the files are. It has no transactions:
   /// a caller that also keeps a record of a file commits the file first.
   class FileStore
   {
     public:
      explicit FileStore(std::filesystem::path root);

      static bool validName(std::string_view name);

      /// Adds `data` to the end of the file being written under `name`,
      /// starting it if there is none. Returns its new size.
      std::optional<std::uint64_t> append(AccountNumber         service,
                                          std::string_view      name,
                                          std::span<const char> data);
      /// Makes the file being written under `pending` available as `final`.
      /// If `final` exists already it is kept (content with the same name is
      /// the same content) and what was written is dropped.
      bool commit(AccountNumber service, std::string_view pending, std::string_view final_);
      /// Removes a committed file, or one being written.
      bool remove(AccountNumber service, std::string_view name, bool pending);
      /// Size of a committed file, or of one being written.
      std::optional<std::uint64_t> size(AccountNumber service, std::string_view name, bool pending);
      /// At most `length` bytes of a committed file from `offset`.
      std::optional<std::vector<char>> read(AccountNumber    service,
                                            std::string_view name,
                                            std::uint64_t    offset,
                                            std::size_t      length);
      /// A committed file, open for reading; -1 if there is none. The caller
      /// closes it.
      int open(AccountNumber service, std::string_view name);

      const std::filesystem::path& root() const { return root_; }

     private:
      std::filesystem::path path(AccountNumber service, std::string_view name, bool pending) const;
      std::filesystem::path root_;
   };
}  // namespace psibase
