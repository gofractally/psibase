#pragma once

#include <psibase/intrinsic.hpp>
#include <psio/graphql_connection.hpp>

namespace psibase
{
   // TODO: use views instead of convert_from_frac
   template <typename Connection,
             typename Value,
             typename Key,
             typename ValueToKey,
             typename SharedValueToNode>
   Connection makeKVConnection(const std::optional<Key>&         gt,
                               const std::optional<Key>&         ge,
                               const std::optional<Key>&         lt,
                               const std::optional<Key>&         le,
                               std::optional<uint32_t>           first,
                               std::optional<uint32_t>           last,
                               const std::optional<std::string>& before,
                               const std::optional<std::string>& after,
                               psibase::kv_map                   map,
                               const Key&                        minKey,
                               const Key&                        maxKey,
                               uint32_t                          keyPrefixSize,
                               ValueToKey                        valueToKey,
                               SharedValueToNode                 sharedValueToNode)
   {
      struct Iter
      {
         std::optional<Key>     key;    // nullopt if end
         std::shared_ptr<Value> value;  // nullptr if end

         std::pair<bool, const Key&> toComparable() const
         {
            static const Key dummy = {};
            if (key)
               return {false, *key};
            else
               return {true, dummy};  // end is greater than non-end
         }

         auto operator==(const Iter& b) const { return toComparable() == b.toComparable(); }
      };

      auto toIter = [&](Value&& value)
      {
         Iter it;
         it.key   = valueToKey(value);
         it.value = std::make_shared<Value>(std::move(value));
         // eosio::print("    toIter key:", *it.key, "\n");
         return it;
      };

      auto iterToKey = [](const Iter& it) -> const Key& { return *it.key; };

      auto iterToNode = [&](const Iter& it) { return sharedValueToNode(it.value); };

      auto lowerBound = [&](const Key& key) -> Iter
      {
         // eosio::print("lowerBound ", key, "\n");
         if (auto b = kvGreaterEqual<Value>(map, key, keyPrefixSize))
            return toIter(std::move(*b));
         else
            return {};
      };

      auto upperBound = [&](const Key& key) -> Iter
      {
         // eosio::print("upperBound ", key, "\n");
         auto k = psio::convert_to_key(key);
         k.push_back(0);
         if (auto v = kv_greater_equal_raw(map, k, keyPrefixSize))
            return toIter(psio::convert_from_frac<Value>(*v));
         else
            return {};
      };

      auto incrIter = [&](Iter& it)
      {
         // eosio::print("incrIter ", *it.key, "\n");
         it = upperBound(valueToKey(*it.value));
      };

      auto decrIter = [&](Iter& it)
      {
         std::vector<char> key;
         if (it.key)
         {
            // eosio::print("decrIter ", *it.key, "\n");
            key = psio::convert_to_key(*it.key);
         }
         else
         {
            // eosio::print("decrIter end\n");
            key = psio::convert_to_key(maxKey);
            key.push_back(0);
         }
         if (auto b = kv_less_than_raw(map, key, keyPrefixSize))
         {
            it = toIter(psio::convert_from_frac<Value>(*b));
         }
         else
            it = {};
      };

      Iter begin, end;
      if (auto b = kvGreaterEqual<Value>(map, minKey, keyPrefixSize))
         begin = toIter(std::move(*b));

      return psio::makeConnection<Connection, Key>(  //
          gt, ge, lt, le, first, last, before, after, begin, end, incrIter, decrIter, iterToKey,
          iterToNode, lowerBound, upperBound);
   }  // makeKVConnection()

}  // namespace psibase
