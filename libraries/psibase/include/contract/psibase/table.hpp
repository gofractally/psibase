#pragma once

#include <boost/mp11/algorithm.hpp>
#include <boost/mp11/list.hpp>
#include <compare>
#include <concepts>
#include <cstdint>
#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>
#include <eosio/to_key.hpp>
#include <functional>
#include <psibase/intrinsic.hpp>
#include <string_view>
#include <type_traits>
#include <utility>
#include <vector>

namespace psibase
{
   struct result_handle
   {
      int size;
   };

   // Eventually replace uses with <=> once the standard library
   // catches up with C++20
   template <typename T>
   std::weak_ordering compare_wknd(const T& lhs, const T& rhs)
   {
      if (lhs < rhs)
         return std::weak_ordering::less;
      else if (rhs < lhs)
         return std::weak_ordering::greater;
      else
         return std::weak_ordering::equivalent;
   }

   class kv_raw_iterator
   {
     public:
      kv_raw_iterator(std::vector<char>&& key, std::size_t prefix_size, bool is_secondary)
          : key(std::move(key)), prefix_size(prefix_size), is_secondary(is_secondary)
      {
         check(prefix_size <= this->key.size(), "prefix is longer than key");
      }
      kv_raw_iterator& operator++()
      {
         if (!is_end)
            key.push_back(0);
         set(raw::kv_greater_equal(map, key.data(), key.size(), prefix_size));
         return *this;
      }
      kv_raw_iterator operator++(int)
      {
         kv_raw_iterator result(*this);
         ++*this;
         return result;
      }
      kv_raw_iterator& operator--()
      {
         set(is_end ? raw::kv_max(map, key.data(), key.size())
                    : raw::kv_less_than(map, key.data(), key.size(), prefix_size));
         return *this;
      }
      kv_raw_iterator operator--(int)
      {
         kv_raw_iterator result(*this);
         --*this;
         return result;
      }
      template <typename C>
      void read(C& c) const
      {
         //static_assert(C::value_type is char, unsigned char, or std::byte);
         int sz = raw::kv_get(map, key.data(), key.size());
         check(sz >= 0, "no such key");
         c.resize(sz);
         raw::get_result(c.data(), c.size());
         if (is_secondary)
         {
            int sz = raw::kv_get(map, c.data(), c.size());
            check(sz >= 0, "primary key not found");
            c.resize(sz);
            raw::get_result(c.data(), c.size());
         }
      }
      std::vector<char> operator*() const
      {
         std::vector<char> result;
         read(result);
         return result;
      }
      // end iterators with the same prefix are equal
      // non-end iterators with the same key are equal
      friend std::weak_ordering operator<=>(const kv_raw_iterator& lhs, const kv_raw_iterator& rhs)
      {
         if (lhs.is_end != rhs.is_end)
            return lhs.is_end <=> rhs.is_end;
         //return lhs.key <=> rhs.key;
         return compare_wknd(lhs.key, rhs.key);
      }
      friend bool operator==(const kv_raw_iterator& lhs, const kv_raw_iterator& rhs)
      {
         return (lhs <=> rhs) == std::weak_ordering::equivalent;
      }
      void move_to(result_handle res) { set(res.size); }

     private:
      void set(int sz)
      {
         if (sz >= 0)
         {
            sz = raw::get_key(nullptr, 0);
            key.resize(sz);
            raw::get_key(key.data(), key.size());
            is_end = false;
         }
         else
         {
            is_end = true;
            key.resize(prefix_size);
         }
      }
      static constexpr kv_map map = kv_map::contract;
      std::vector<char>       key;
      std::size_t             prefix_size;
      bool                    is_end       = true;
      bool                    is_secondary = false;
   };

   template <typename T>
   struct kv_iterator
   {
     public:
      kv_iterator(std::vector<char>&& key, std::size_t prefix_size, bool is_secondary)
          : base(std::move(key), prefix_size, is_secondary)
      {
      }
      kv_iterator& operator++()
      {
         ++base;
         return *this;
      }
      kv_iterator operator++(int)
      {
         auto result = *this;
         ++*this;
         return result;
      }
      kv_iterator& operator--()
      {
         --base;
         return *this;
      }
      kv_iterator operator--(int)
      {
         auto result = *this;
         --*this;
         return result;
      }
      T                         operator*() const { return eosio::convert_from_bin<T>(*base); }
      friend std::weak_ordering operator<=>(const kv_iterator& lhs,
                                            const kv_iterator& rhs) = default;

     private:
      kv_raw_iterator base;
   };

   template <typename T>
   void append_to_key(std::vector<char>& key, const T& t)
   {
      eosio::size_stream ss;
      eosio::to_key(t, ss);
      key.resize(key.size() + ss.size);
   }

   struct key_view
   {
      std::string_view data;
   };
   template <typename S>
   void to_key(const key_view& k, S& s)
   {
      s.write(k.data.data(), k.data.size());
   }

   template <typename T, typename U>
   struct compatible_tuple
   {
      static constexpr bool value = false;
   };

   template <typename T, typename U>
   concept compatible_key_unqual = std::same_as<T, U> || compatible_tuple<T, U>::value;

   template <typename T, typename U>
   concept compatible_key = compatible_key_unqual<std::remove_cvref_t<T>, std::remove_cvref_t<U>>;

   template <typename... T, typename... U>
   requires(compatible_key<T, U>&&...) struct compatible_tuple<std::tuple<T...>, std::tuple<U...>>
   {
      static constexpr bool value = true;
   };

   template <typename T, typename U>
   struct compatible_tuple_prefix
   {
      static constexpr bool value = false;
   };
   template <typename... T, typename... U>
   requires(sizeof...(T) <=
            sizeof...(U)) struct compatible_tuple_prefix<std::tuple<T...>, std::tuple<U...>>
   {
      static constexpr bool value =
          compatible_tuple<boost::mp11::mp_take_c<std::tuple<U...>, sizeof...(T)>,
                           std::tuple<T...>>::value;
   };
   template <typename T, typename... U>
   requires(sizeof...(U) >= 1) struct compatible_tuple_prefix<T, std::tuple<U...>>
   {
      static constexpr bool value = compatible_key<boost::mp11::mp_front<std::tuple<U...>>, T>;
   };

   template <typename T, typename U>
   concept compatible_key_prefix_unqual = std::same_as<T, U> || compatible_tuple_prefix<T, U>::value;
   template <typename T, typename U>
   concept compatible_key_prefix =
       compatible_key_prefix_unqual<std::remove_cvref_t<T>, std::remove_cvref_t<U>>;

   template <typename T, typename U>
   struct key_suffix_unqual
   {
      using type = void;
   };
   template <typename... T, typename... U>
   struct key_suffix_unqual<std::tuple<T...>, std::tuple<U...>>
   {
      using type = boost::mp11::mp_drop_c<std::tuple<U...>, sizeof...(T)>;
   };
   template <typename T, typename... U>
   struct key_suffix_unqual<T, std::tuple<U...>>
   {
      using type = boost::mp11::mp_drop_c<std::tuple<U...>, 1>;
   };
   template <typename T>
   struct key_suffix_unqual<T, T>
   {
      using type = std::tuple<>;
   };

   template <typename T, typename U>
   using key_suffix =
       typename key_suffix_unqual<std::remove_cvref_t<T>, std::remove_cvref_t<U>>::type;

   template <typename T, typename K>
   class index
   {
     public:
      explicit index(std::vector<char>&& prefix) : prefix(std::move(prefix)) {}
      kv_iterator<T> begin() const
      {
         kv_iterator<T> result = end();
         ++result;
         return result;
      }
      kv_iterator<T> end() const
      {
         auto copy = prefix;
         return kv_iterator<T>(std::move(copy), prefix.size(), is_secondary());
      }
      kv_iterator<T> lower_bound(compatible_key_prefix<K> auto&& k) const
      {
         key_view       key_base{{prefix.data(), prefix.size()}};
         auto           key = eosio::convert_to_key(std::tie(key_base, k));
         result_handle  res = {raw::kv_greater_equal(key.data(), key.size(), prefix.size())};
         kv_iterator<T> result(std::move(key), prefix.size(), is_secondary());
         result.move_to(res);
         return result;
      }
      kv_iterator<T> upper_bound(compatible_key_prefix<K> auto&& k) const
      {
         key_view key_base{{prefix.data(), prefix.size()}};
         auto     key = eosio::convert_to_key(std::tie(key_base, k));
         while (true)
         {
            if (key.size() <= prefix.size())
               return end();
            if (static_cast<unsigned char>(key.back()) != 0xffu)
            {
               ++key.back();
               break;
            }
            key.pop_back();
         }
         result_handle  res = {raw::kv_greater_equal(key.data(), key.size(), prefix.size())};
         kv_iterator<T> result(std::move(key), prefix.size(), is_secondary());
         result.move_to(res);
         return result;
      }
      template <compatible_key_prefix<K> K2>
      index<T, key_suffix<K2, K>> subindex(K2&& k)
      {
         key_view key_base{{prefix.data(), prefix.size()}};
         auto     key = eosio::convert_to_key(std::tie(key_base, k));
         return index<T, key_suffix<K2, K>>(std::move(key));
      }
      std::optional<T> get(compatible_key<K> auto&& k) const
      {
         key_view key_base{{prefix.data(), prefix.size()}};
         auto     buffer = eosio::convert_to_key(std::tie(key_base, k));
         int      res    = raw::kv_get(map, buffer.data(), buffer.size());
         if (res < 0)
         {
            return {};
         }
         buffer.resize(res);
         raw::get_result(buffer.data(), buffer.size());
         if (is_secondary())
         {
            res = raw::kv_get(map, buffer.data(), buffer.size());
            buffer.resize(res);
            raw::get_result(buffer.data(), buffer.size());
         }
         return eosio::convert_from_bin<T>(buffer);
      }

     private:
      bool                    is_secondary() const { return prefix[8] != 0; }
      static constexpr kv_map map = kv_map::contract;
      std::vector<char>       prefix;
   };

   template <auto V>
   struct wrap
   {
      static constexpr decltype(V) value = V;
   };

   inline void kv_insert(kv_map      map,
                         const char* key,
                         std::size_t key_len,
                         const char* value,
                         std::size_t value_len)
   {
      if (raw::kv_get(map, key, key_len) != -1)
      {
         eosio::check(false, "key already exists");
      }
      raw::kv_put(map, key, key_len, value, value_len);
   }

   template <typename T, auto Primary, auto... Secondary>
   class table
   {
     public:
      static_assert(1 + sizeof...(Secondary) <= 255, "Too many indices");
      explicit table(key_view prefix) : prefix(prefix.data.begin(), prefix.data.end()) {}
      explicit table(std::vector<char>&& prefix) : prefix(std::move(prefix)) {}
      void put(const T& arg)
      {
         auto pk = serialize_key(0, std::invoke(Primary, arg));
         if constexpr (sizeof...(Secondary) > 0)
         {
            int               sz         = raw::kv_get(map, pk.data(), pk.size());
            std::vector<char> key_buffer = prefix;
            key_buffer.push_back(0);
            if (sz != -1)
            {
               std::vector<char> buffer(sz);
               raw::get_result(buffer.data(), buffer.size());
               auto data              = eosio::convert_from_bin<T>(std::move(buffer));
               auto replace_secondary = [&](uint8_t& idx, auto wrapped) {
                  auto old_key = std::invoke(decltype(wrapped)::value, data);
                  auto new_key = std::invoke(decltype(wrapped)::value, arg);
                  if (old_key != new_key)
                  {
                     key_buffer.back() = idx;
                     eosio::convert_to_key(old_key, key_buffer);
                     raw::kv_remove(map, key_buffer.data(), key_buffer.size());
                     key_buffer.resize(prefix.size() + 1);
                     eosio::convert_to_key(new_key, key_buffer);
                     kv_insert(map, key_buffer.data(), key_buffer.size(), pk.data(), pk.size());
                     key_buffer.resize(prefix.size() + 1);
                  }
                  ++idx;
               };
               uint8_t idx = 1;
               (replace_secondary(idx, wrap<Secondary>()), ...);
            }
            else
            {
               auto write_secondary = [&](uint8_t idx, auto wrapped) {
                  auto key          = std::invoke(decltype(wrapped)::value, arg);
                  key_buffer.back() = idx;
                  eosio::convert_to_key(key, key_buffer);
                  kv_insert(map, key_buffer.data(), key_buffer.size(), pk.data(), pk.size());
                  key_buffer.resize(prefix.size() + 1);
                  ++idx;
               };
               std::uint8_t idx = 1;
               (write_secondary(idx, wrap<Secondary>()), ...);
            }
         }
         auto serialized = eosio::convert_to_bin(arg);
         raw::kv_put(map, pk.data(), pk.size(), serialized.data(), serialized.size());
      }
      // TODO: get index by name
      template <int Idx>
      auto get_index() const
      {
         using key_extractor =
             boost::mp11::mp_at_c<boost::mp11::mp_list<wrap<Primary>, wrap<Secondary>...>, Idx>;
         using key_type =
             std::remove_cvref_t<decltype(std::invoke(key_extractor::value, std::declval<T>()))>;
         auto index_prefix = prefix;
         index_prefix.push_back(static_cast<char>(Idx));
         return index<T, key_type>(std::move(index_prefix));
      }

     private:
      std::vector<char> serialize_key(uint8_t idx, auto&& k)
      {
         key_view key_base{{prefix.data(), prefix.size()}};
         return eosio::convert_to_key(std::tie(key_base, idx, k));
      }
      static constexpr kv_map map = kv_map::contract;
      std::vector<char>       prefix;
   };

   // TODO: allow tables to be forward declared.  The simplest method is:
   // struct xxx : table<...> {};
   template <typename... Tables>
   struct contract_tables
   {
      explicit constexpr contract_tables(account_num account) : account(account) {}
      template <std::uint32_t Table>
      auto open()
      {
         std::vector<char> key_prefix = eosio::convert_to_key(std::tuple(account, Table));
         return boost::mp11::mp_at_c<boost::mp11::mp_list<Tables...>, Table>(std::move(key_prefix));
      }
      template <typename T>
      auto open()
      {
         return open<boost::mp11::mp_find<boost::mp11::mp_list<Tables...>, T>::value>();
      }
      account_num account;
   };
}  // namespace psibase
