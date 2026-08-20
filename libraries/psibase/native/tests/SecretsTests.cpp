#include <psibase/Secrets.hpp>

#include "TempDirectory.hpp"

#include <catch2/catch_all.hpp>

using namespace psibase;

using namespace std::literals::string_view_literals;

std::string_view sv(std::optional<std::span<const char>> value)
{
   if (value)
      return {value->data(), value->size()};
   else
      return {};
}

TEST_CASE("Secret put/get")
{
   TempDirectory    dir;
   std::string_view passphrase = "open sesame";
   Secrets          secrets{dir.path / "secrets", passphrase};
   secrets.put("a"sv, "value"sv);
   CHECK(sv(secrets.get("a"sv)) == "value");
}

TEST_CASE("Secret load")
{
   TempDirectory    dir;
   std::string_view passphrase = "open sesame";
   {
      Secrets secrets{dir.path / "secrets", passphrase};
      secrets.put("a"sv, "value"sv);
   }
   {
      Secrets secrets{dir.path / "secrets", passphrase};
      CHECK(sv(secrets.get("a"sv)) == "value");
   }
}

TEST_CASE("Wrong passphrase")
{
   TempDirectory dir;
   {
      Secrets secrets{dir.path / "secrets", "open sesame"};
      secrets.put("a"sv, "value"sv);
   }
   {
      CHECK_THROWS(Secrets{dir.path / "secrets", "open sez me"});
   }
}

TEST_CASE("Secrets temporary")
{
   TempDirectory dir;
   {
      Secrets secrets{dir.path / "secrets", ""};
      secrets.put("a"sv, "value"sv);
      CHECK(!std::filesystem::exists(dir.path / "secrets"));
   }
   {
      Secrets secrets{dir.path / "secrets", ""};
      CHECK(secrets.get("a"sv) == std::nullopt);
   }
}
