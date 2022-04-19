#pragma once

#include <psio/fracpack.hpp>
#include <string>

namespace psibase
{
   class Memo
   {
     public:
      static constexpr uint8_t MAX_BYTES = 80;

      Memo() : _memo("") {}
      Memo(const std::string& memo) : _memo(memo) { _check(memo); };

      operator std::string() const { return _memo; }

     private:
      _check(const std::string& memo)
      {
         check(memo.size() <= MAX_BYTES, "memo has more than max allowed bytes");
      }
      std::string _memo;
   };
   PSIO_REFLECT(Memo, _memo)
   EOSIO_REFLECT(Memo, _memo)  //Todo - remove when kv table uses PSIO

}  // namespace psibase
