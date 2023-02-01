#include <psibase/ExecutionContext.hpp>
#include <psibase/log.hpp>

#define CATCH_CONFIG_RUNNER
#include <catch2/catch.hpp>

using namespace psibase;

int main(int argc, const char* const* argv)
{
   const char* log_config = R"(
{
  "stderr": {
    "type": "console",
    "filter": "Severity >= info",
    "format": "[{Severity}] [{Host}]: {Message}{?: {BlockId}: {BlockHeader}}"
  }
}
)";

   ExecutionContext::registerHostFunctions();
   loggers::configure(psio::convert_from_json<loggers::Config>(log_config));

   return Catch::Session().run(argc, argv);
}
