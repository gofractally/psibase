// Compile-only service fixture: dispatch must instantiate using numeric IDs,
// without linking the statistical encoder, decoder or model tables at runtime.
#include <psibase/dispatch.hpp>

struct ActionNameDispatchFixture : psibase::Service
{
   void          registerEventIndex(std::uint64_t value) {}
   std::uint64_t readData() const { return 7; }
};
PSIO_REFLECT(ActionNameDispatchFixture, method(registerEventIndex, value), method(readData))

extern "C" void action_name_dispatch_probe(psibase::AccountNumber sender,
                                           psibase::AccountNumber receiver)
{
   psibase::dispatch<ActionNameDispatchFixture>(sender, receiver);
}
