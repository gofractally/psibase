#include <charconv>
#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/Transact.hpp>

using namespace psibase;
using namespace SystemService;

struct SocketAuth : Service
{
   static constexpr AccountNumber service{"s-socket-auth"};

   void checkAuthSys(uint32_t                    flags,
                     psibase::AccountNumber      requester,
                     psibase::AccountNumber      sender,
                     ServiceMethod               action,
                     std::vector<ServiceMethod>  allowedActions,
                     std::vector<psibase::Claim> claims)
   {
      if (action.method == MethodNumber{"autoClose"})
      {
         socketAutoClose(1, true);
      }
   }

   void canAuthUserSys(psibase::AccountNumber user) {}
};

PSIO_REFLECT(SocketAuth,
             method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
             method(canAuthUserSys, user))

PSIBASE_DISPATCH(SocketAuth)
