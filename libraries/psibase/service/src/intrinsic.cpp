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

   // A packed Action with no members this build does not know.
   // (psio::validate_strict needs exceptions for a type with adapters: in a
   // guest it reports "unsupported".)
   static void checkActionFormat(std::span<const char> data)
   {
      bool unknown = false;
      check(psio::validate_pssz_compatible<Action>(psio::pssz{}, data, unknown).ok() && !unknown,
            "invalid action format");
   }

   psio::shared_pssz<Action> getCurrentActionView()
   {
      auto data = getResult(raw::getCurrentAction());
      checkActionFormat(data);
      return psio::shared_pssz<Action>::unchecked(std::move(data));
   }

   psio::pssz_buffer<Action> getCurrentActionPacked()
   {
      auto data = getResult(raw::getCurrentAction());
      checkActionFormat(data);
      return psio::pssz_buffer<Action>::unchecked(std::move(data));
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
