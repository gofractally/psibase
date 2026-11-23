#include <psibase/api.hpp>

namespace psibase
{
   std::vector<char> getResult(uint32_t size)
   {
      std::vector<char> result(size);
      if (size)
         raw::getResult(result.data(), result.size(), 0);
      return result;
   }

   std::vector<char> getResult()
   {
      return getResult(raw::getResult(nullptr, 0, 0));
   }

   std::vector<char> getKey(uint32_t size)
   {
      std::vector<char> key(size);
      if (size)
         raw::getKey(key.data(), key.size());
      return key;
   }

   std::vector<char> getKey()
   {
      return getKey(raw::getKey(nullptr, 0));
   }

   Action getCurrentAction()
   {
      auto data = getResult(raw::getCurrentAction());
      return psio::from_pssz<Action>(psio::trusted{data});
   }

   psio::shared_pssz<Action> getCurrentActionView()
   {
      auto data = getResult(raw::getCurrentAction());
      check(psio::validate_strict<Action>(psio::pssz{}, data).ok(), "invalid action format");
      return psio::shared_pssz<Action>::unchecked(std::move(data));
   }

   std::vector<char> call(const char* action, uint32_t len, CallFlags flags)
   {
      return getResult(raw::call(action, len, flags));
   }

   std::vector<char> call(psio1::input_stream action, CallFlags flags)
   {
      return getResult(raw::call(action.pos, action.remaining(), flags));
   }

   std::vector<char> call(const Action& action, CallFlags flags)
   {
      return call(psio::to_pssz(action), flags);
   }
}  // namespace psibase
