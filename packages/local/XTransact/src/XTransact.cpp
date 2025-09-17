#include <services/local/XTransact.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/RTransact.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace
{
   void checkAuth(AccountNumber sender)
   {
      // Temporary check. Permissions should be managed by XSetCode
      // when it exists.
      if (sender != RTransact::service)
         abortMessage(sender.str() + " is not allowed to post async actions");
   }
   NotifyType getNotifyType(TransactionCallbackType type)
   {
      switch (type)
      {
         case TransactionCallbackType::nextTransaction:
            return NotifyType::nextTransaction;
         case TransactionCallbackType::preverifyTransaction:
            return NotifyType::preverifyTransaction;
         default:
            abortMessage("Unknown callback type");
      }
   }
}  // namespace

void XTransact::addCallback(TransactionCallbackType type, MethodNumber callback)
{
   auto sender = getSender();
   checkAuth(sender);
   auto notifyType = getNotifyType(type);
   auto table      = Native::subjective().open<NotifyTable>();
   if (auto existing = table.get(notifyType))
   {
      if (!std::ranges::any_of(existing->actions, [&](const auto& act)
                               { return act.service == sender && act.method == callback; }))
      {
         existing->actions.push_back({.service = sender, .method = callback});
         table.put(*existing);
      }
   }
   else
   {
      table.put(NotifyRow{notifyType, {{.service = sender, .method = callback}}});
   }
}

void XTransact::removeCallback(TransactionCallbackType type, MethodNumber callback)
{
   auto sender = getSender();
   checkAuth(sender);
   auto notifyType = getNotifyType(type);
   auto table      = Native::subjective().open<NotifyTable>();
   auto key        = notifyKey(notifyType);
   if (auto existing = table.get(notifyType))
   {
      std::erase_if(existing->actions, [&](const auto& act)
                    { return act.service == sender && act.method == callback; });
      if (existing->actions.empty())
      {
         table.remove(*existing);
      }
      else
      {
         table.put(*existing);
      }
   }
}

PSIBASE_DISPATCH(XTransact)
