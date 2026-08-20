#pragma once

#include <filesystem>
#include <memory>
#include <optional>
#include <span>

namespace psibase
{
   class Secrets
   {
     public:
      Secrets(const std::filesystem::path& file, std::string_view passphrase);
      ~Secrets();
      std::optional<std::span<const char>> get(std::span<const char> key);
      void put(std::span<const char> key, std::span<const char> value);
      void remove(std::span<const char> key);

     private:
      struct Impl;
      std::unique_ptr<Impl> impl;
   };
}  // namespace psibase
