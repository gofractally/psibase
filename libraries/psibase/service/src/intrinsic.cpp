#include <psibase/nativeFunctions.hpp>

#include <psio/from_bin.hpp>

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
      return psio::convert_from_frac<Action>(data);
   }

   psio::shared_view_ptr<Action> getCurrentActionView()
   {
      psio::shared_view_ptr<Action> ptr(psio::size_tag{raw::getCurrentAction()});
      raw::getResult(ptr.data(), ptr.size(), 0);
      check(ptr.validate_all_known(), "invalid action format");
      return ptr;
   }

   std::vector<char> call(const char* action, uint32_t len)
   {
      return getResult(raw::call(action, len));
   }

   std::vector<char> call(psio::input_stream action)
   {
      return getResult(raw::call(action.pos, action.remaining()));
   }

   std::vector<char> call(const Action& action)
   {
      return call(psio::convert_to_frac(action));
   }
}  // namespace psibase
