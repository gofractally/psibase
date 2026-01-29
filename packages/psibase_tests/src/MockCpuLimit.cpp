#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/chrono.hpp>

#include <chrono>

// This is a replacement for CpuLimit that always returns a fixed value
// to make tests deterministic
class MockCpuLimit : public psibase::Service
{
  public:
   static constexpr auto service      = psibase::AccountNumber("cpu-limit");
   static constexpr auto serviceFlags = psibase::CodeRow::isPrivileged;

   std::chrono::nanoseconds getCpuTime() { return std::chrono::microseconds(100); }
   void                     setCpuLimit(std::optional<uint64_t> limit_ns) {}
};
PSIO_REFLECT(MockCpuLimit, method(getCpuTime), method(setCpuLimit, limit_ns))
PSIBASE_REFLECT_TABLES(MockCpuLimit)

PSIBASE_DISPATCH(MockCpuLimit)
