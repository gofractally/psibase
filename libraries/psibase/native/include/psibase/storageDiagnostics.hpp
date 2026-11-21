#pragma once
#include <filesystem>
#include <string>
#include <string_view>
namespace psibase::storage
{
   // /proc/self/smaps reports resolved file paths. Match path components,
   // never a textual prefix (db-other must not be attributed to db).
   inline bool databaseMapping(std::string_view mapping, const std::filesystem::path& directory)
   {
      if (directory.empty() || !directory.is_absolute())
         return false;
      constexpr std::string_view deleted = " (deleted)";
      if (mapping.ends_with(deleted))
         mapping.remove_suffix(deleted.size());
      if (mapping.empty() || mapping.front() != '/')
         return false;
      std::string decoded;
      for (std::size_t i = 0; i < mapping.size(); ++i)
      {
         if (mapping[i] == '\\' && i + 3 < mapping.size() && mapping[i + 1] >= '0' &&
             mapping[i + 1] <= '7' && mapping[i + 2] >= '0' && mapping[i + 2] <= '7' &&
             mapping[i + 3] >= '0' && mapping[i + 3] <= '7')
         {
            decoded.push_back(char((mapping[i + 1] - '0') * 64 + (mapping[i + 2] - '0') * 8 +
                                   mapping[i + 3] - '0'));
            i += 3;
         }
         else
            decoded.push_back(mapping[i]);
      }
      const auto path     = std::filesystem::path(decoded).lexically_normal();
      const auto base     = directory.lexically_normal();
      auto       filePart = path.begin();
      for (auto part = base.begin(); part != base.end(); ++part, ++filePart)
         if (filePart == path.end() || *filePart != *part)
            return false;
      return filePart != path.end();
   }
}  // namespace psibase::storage
