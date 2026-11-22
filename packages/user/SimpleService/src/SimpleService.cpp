#include <psibase/psibase.hpp>

namespace company
{
   class MinService : public psibase::Service
   {
     public:
      static constexpr psibase::AccountNumber id = psibase::AccountNumber("simpleserv");
      void                                    hello() { psibase::writeConsole("hello world"); }
   };

   PSIO_REFLECT(MinService, method(hello))
   PSIBASE_REFLECT_TABLES(MinService)
}  // namespace company

PSIBASE_DISPATCH(company::MinService)
