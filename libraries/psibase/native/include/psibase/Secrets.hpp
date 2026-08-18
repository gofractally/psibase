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
      Secrets(const std::filesystem::path& file, std::span<const char, 32> master_key);
      ~Secrets();
      std::optional<std::span<const char>> get(std::span<const char> key);
      void put(std::span<const char> key, std::span<const char> value);

     private:
      struct Impl;
      std::unique_ptr<Impl> impl;
   };
}  // namespace psibase
