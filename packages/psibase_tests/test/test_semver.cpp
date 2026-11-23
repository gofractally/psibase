#include <catch2/catch_all.hpp>
#include <psibase/semver.hpp>
#include <psibase/tester.hpp>
#include <psio/json.hpp>
#include <string>

struct SemverTest
{
   std::string pattern;
   std::string version;
   bool        matches;
};
PSIO_REFLECT(SemverTest, pattern, version, matches)

TEST_CASE("semver")
{
   std::vector<SemverTest> tests;
   {
      auto contents = psibase::readWholeFile("semver.json");
      tests         = psio::from_ijson<std::vector<SemverTest>>(contents);
   }
   for (const auto& [pattern, version, matches] : tests)
   {
      INFO("pattern: " << pattern);
      INFO("version: " << version);
      CHECK(psibase::versionMatch(pattern, version) == matches);
   }
}
