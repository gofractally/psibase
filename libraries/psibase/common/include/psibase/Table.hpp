#pragma once

#include <boost/mp11/algorithm.hpp>
#include <boost/mp11/list.hpp>
#include <compare>
#include <concepts>
#include <cstdint>
#include <functional>
#include <psibase/blob.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psio/to_key.hpp>
#include <span>
#include <string_view>
#include <type_traits>
#include <utility>
#include <vector>

namespace psibase
{
   // Eventually replace uses with <=> once the standard library
   // catches up with C++20
   // Maybe not; char is signed
   // TODO: consider a global replace of vector<char> with vector<uint8_t>, including in psio
   template <typename T>
   std::weak_ordering compare_wknd(const T& lhs, const T& rhs)
   {
      auto cmp = compare_blob(lhs, rhs);
      if (cmp < 0)
         return std::weak_ordering::less;
      else if (cmp > 0)
         return std::weak_ordering::greater;
      else
         return std::weak_ordering::equivalent;
   }

   class kv_raw_iterator
   {
     public:
      kv_raw_iterator(DbId                db,
                      std::vector<char>&& key,
                      std::size_t         prefix_size,
                      bool                is_secondary,
                      bool                is_end)
          : db(db),
            key(std::move(key)),
            prefix_size(prefix_size),
            is_secondary(is_secondary),
            is_end(is_end)
      {
         check(prefix_size <= this->key.size(), "prefix is longer than key");
      }
      kv_raw_iterator& operator++()
      {
         if (!is_end)
            key.push_back(0);
         set(raw::kvGreaterEqual(db, key.data(), key.size(), prefix_size));
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
         set(is_end ? raw::kvMax(db, key.data(), key.size())
                    : raw::kvLessThan(db, key.data(), key.size(), prefix_size));
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
         int sz = raw::kvGet(db, key.data(), key.size());
         check(sz >= 0, "no such key");
         c.resize(sz);
         raw::getResult(c.data(), c.size(), 0);
         if (is_secondary)
         {
            int sz = raw::kvGet(db, c.data(), c.size());
            check(sz >= 0, "primary key not found");
            c.resize(sz);
            raw::getResult(c.data(), c.size(), 0);
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
      void move_to(int res) { set(res); }
      void move_to(std::span<const char> keyWithoutPrefix)
      {
         key.resize(prefix_size);
         key.insert(key.end(), keyWithoutPrefix.begin(), keyWithoutPrefix.end());
         is_end = !keyWithoutPrefix.empty();
      }
      std::span<const char> keyWithoutPrefix() const
      {
         return {key.data() + prefix_size, key.size() - prefix_size};
      }

     private:
      void set(int sz)
      {
         if (sz >= 0)
         {
            sz = raw::getKey(nullptr, 0);
            key.resize(sz);
            raw::getKey(key.data(), key.size());
            is_end = false;
         }
         else
         {
            is_end = true;
            key.resize(prefix_size);
         }
      }
      DbId              db;
      std::vector<char> key;
      std::size_t       prefix_size;
      bool              is_secondary = false;
      bool              is_end       = true;
   };

   /// An iterator into a [TableIndex]
   ///
   /// Use [TableIndex::begin], [TableIndex::end], [TableIndex::lower_bound], or [TableIndex::upper_bound]
   /// to get an iterator.
   template <typename T>
   struct KvIterator
   {
     public:
      /// constructor
      ///
      /// * `db` identifies the database the table lives in.
      /// * See the "Key" column of [Data format](#data-format); the `key` field contains this.
      /// * `prefixSize` is the number of bytes within `key` which covers the index's prefix (includes the index number byte).
      /// * `isSecondary` is true if this iterator is for a secondary index.
      /// * `isEnd` is true if this iterator points past the end.
      ///
      /// You don't need this constructor in most cases; use [TableIndex::begin], [TableIndex::end],
      /// [TableIndex::lower_bound], or [TableIndex::upper_bound] instead.
      KvIterator(DbId                db,
                 std::vector<char>&& key,
                 std::size_t         prefixSize,
                 bool                isSecondary,
                 bool                isEnd)
          : base(db, std::move(key), prefixSize, isSecondary, isEnd)
      {
      }

      /// preincrement (++it)
      ///
      /// This moves the iterator forward.
      ///
      /// The iterator has circular semantics. If you increment an end iterator, then it
      /// moves to the beginning of the index, or back to end again if empty.
      KvIterator& operator++()
      {
         ++base;
         return *this;
      }

      /// postincrement (it++)
      ///
      /// This moves the iterator forward.
      ///
      /// The iterator has circular semantics. If you increment an end iterator, then it
      /// moves to the beginning of the index, or back to end again if empty.
      ///
      /// Note: postincrement (`it++`) and postdecrement (`it--`) have higher
      /// overhead than preincrement (`++it`) and predecrement (`--it`).
      KvIterator operator++(int)
      {
         auto result = *this;
         ++*this;
         return result;
      }

      /// predecrement (--it)
      ///
      /// This moves the iterator backward.
      ///
      /// The iterator has circular semantics. If you decrement a begin iterator, then it
      /// moves to end.
      KvIterator& operator--()
      {
         --base;
         return *this;
      }

      /// postdecrement (it--)
      ///
      /// This moves the iterator backward.
      ///
      /// The iterator has circular semantics. If you decrement a begin iterator, then it
      /// moves to end.
      ///
      /// Note: postincrement (`it++`) and postdecrement (`it--`) have higher
      /// overhead than preincrement (`++it`) and predecrement (`--it`).
      KvIterator operator--(int)
      {
         auto result = *this;
         --*this;
         return result;
      }

      /// Move iterator
      ///
      /// This moves the iterator to the most-recent location found by
      /// [raw::kvGreaterEqual], [raw::kvLessThan], or [raw::kvMax].
      ///
      /// `result` is the return value of the raw call.
      ///
      /// You don't need this function in most cases; use [TableIndex::begin], [TableIndex::end],
      /// [TableIndex::lower_bound], [TableIndex::upper_bound], or the iterator's increment or
      /// decrement operators instead.
      void moveTo(int result) { base.move_to(result); }

      /// Move iterator
      ///
      /// This moves the iterator to `k`. `k` does not include the prefix.
      /// May be used for GraphQL cursors; see [keyWithoutPrefix].
      void moveTo(std::span<const char> k) { base.move_to(k); }

      /// Get serialized key without prefix
      ///
      /// The returned value can be passed to `moveTo`, e.g. for GraphQL cursors.
      std::span<const char> keyWithoutPrefix() const { return base.keyWithoutPrefix(); }

      /// get object
      ///
      /// This reads an object from the database. It does not cache; it returns a fresh object
      /// each time it's used.
      T operator*() const { return psio::convert_from_frac<T>(*base); }

      /// Comparisons
      std::weak_ordering operator<=>(const KvIterator& rhs) const = default;

     private:
      kv_raw_iterator base;
   };

   /// A serialized key (non-owning)
   ///
   /// The serialized data has the same sort order as the non-serialized form
   struct KeyView
   {
      std::span<const char> data;
   };
   template <typename S>
   void to_key(const KeyView& k, S& s)
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
   concept compatible_key_prefix_unqual =
       std::same_as<T, U> || compatible_tuple_prefix<T, U>::value || std::same_as<T, KeyView>;
   template <typename T, typename U>
   concept CompatibleKeyPrefix =
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
   using KeySuffix =
       typename key_suffix_unqual<std::remove_cvref_t<T>, std::remove_cvref_t<U>>::type;

   /// A primary or secondary index in a Table
   ///
   /// Use [Table::getIndex] to get this.
   ///
   /// Template arguments:
   /// - `T`: Type of object stored in table
   /// - `K`: Type of key this index uses
   template <typename T, typename K>
   class TableIndex
   {
     public:
      /// Construct with prefix
      ///
      /// `prefix` identifies the range of database keys that the index occupies.
      TableIndex(DbId db, std::vector<char>&& prefix, bool is_secondary)
          : db(db), prefix(std::move(prefix)), is_secondary(is_secondary)
      {
      }

      /// Get iterator to first object
      KvIterator<T> begin() const
      {
         KvIterator<T> result = end();
         ++result;
         return result;
      }

      /// Get iterator past the end
      KvIterator<T> end() const
      {
         auto copy = prefix;
         return KvIterator<T>(db, std::move(copy), prefix.size(), is_secondary, true);
      }

      /// Get iterator to first object with `key >= k`
      ///
      /// If the index's key is an `std::tuple`, then `k` may be the first `n` fields
      /// of the key.
      ///
      /// Returns [end] if none found.
      template <CompatibleKeyPrefix<K> K2>
      KvIterator<T> lower_bound(K2&& k) const
      {
         KeyView       key_base{{prefix.data(), prefix.size()}};
         auto          key = psio::convert_to_key(std::tie(key_base, k));
         auto          res = raw::kvGreaterEqual(db, key.data(), key.size(), prefix.size());
         KvIterator<T> result(db, std::move(key), prefix.size(), is_secondary, true);
         result.moveTo(res);
         return result;
      }

      /// Get iterator to first object with `key > k`
      ///
      /// If the index's key is an `std::tuple`, then `k` may be the first `n` fields
      /// of the key.
      ///
      /// Returns [end] if none found.
      template <CompatibleKeyPrefix<K> K2>
      KvIterator<T> upper_bound(K2&& k) const
      {
         KeyView key_base{{prefix.data(), prefix.size()}};
         auto    key = psio::convert_to_key(std::tie(key_base, k));
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
         auto          res = raw::kvGreaterEqual(db, key.data(), key.size(), prefix.size());
         KvIterator<T> result(db, std::move(key), prefix.size(), is_secondary, true);
         result.moveTo(res);
         return result;
      }

      /// Divide the key space
      ///
      /// Assume `K` is a `std::tuple<A, B, C, D>`. If you call `subindex` with
      /// a tuple with the first `n` fields of `K`, e.g. `std::tuple(aValue, bValue)`,
      /// then `subindex` returns another `TableIndex` which restricts its view
      /// to the subrange. e.g. it will iterate and search for `std::tuple(cValue, dValue)`,
      /// holding `aValue` and `bValue` constant.
      template <CompatibleKeyPrefix<K> K2>
      TableIndex<T, KeySuffix<K2, K>> subindex(K2&& k)
      {
         KeyView key_base{{prefix.data(), prefix.size()}};
         auto    key = psio::convert_to_key(std::tie(key_base, k));
         return TableIndex<T, KeySuffix<K2, K>>(db, std::move(key), is_secondary);
      }

      /// Look up object by key
      ///
      /// If a matching key is found, then it returns a fresh object;
      /// it does not cache.
      template <compatible_key<K> K2>
      std::optional<T> get(K2&& k) const
      {
         KeyView key_base{{prefix.data(), prefix.size()}};
         auto    buffer = psio::convert_to_key(std::tie(key_base, k));
         int     res    = raw::kvGet(db, buffer.data(), buffer.size());
         if (res < 0)
         {
            return {};
         }
         buffer.resize(res);
         raw::getResult(buffer.data(), buffer.size(), 0);
         if (is_secondary)
         {
            res = raw::kvGet(db, buffer.data(), buffer.size());
            buffer.resize(res);
            raw::getResult(buffer.data(), buffer.size(), 0);
         }
         return psio::convert_from_frac<T>(buffer);
      }

     private:
      DbId              db;
      std::vector<char> prefix;
      bool              is_secondary;
   };

   template <auto V>
   struct wrap
   {
      static constexpr decltype(V) value = V;
   };

   inline void kvInsertUnique(DbId        db,
                              const char* key,
                              std::size_t key_len,
                              const char* value,
                              std::size_t value_len)
   {
      if (raw::kvGet(db, key, key_len) != -1)
      {
         check(false, "key already exists");
      }
      raw::kvPut(db, key, key_len, value, value_len);
   }

   /// Stores objects in the key-value database
   ///
   /// Template arguments:
   /// - `T`: Type of object stored in table
   /// - `Primary`: fetches primary key from an object
   /// - `Secondary`: fetches a secondary key from an object. This is optional; there may be 0 or more secondary keys.
   ///
   /// `Primary` and `Secondary` may be:
   /// - pointer-to-data-member. e.g. `&MyType::key`
   /// - pointer-to-member-function which returns a key. e.g. `&MyType::keyFunction`
   /// - non-member function which takes a `const T&` as its only argument and returns a key
   /// - a callable object which takes a `const T&` as its only argument and returns a key
   ///
   /// #### Schema changes
   ///
   /// You may modify the schema of an existing table the following ways:
   /// - Add new `optional<...>` fields to the end of `T`, unless `T` is marked `definitionWillNotChange()`. When you read old records, these values will be `std::nullopt`.
   /// - If `T` has a field with type `X`, then you may add new `optional<...>` fields to the end of `X`, unless `X` is marked `definitionWillNotChange()`. This rule is recursive, including through `vector`, `optional`, and user-defined types.
   /// - Add new secondary indexes after the existing ones. Old records will not appear in the new secondary indexes. Remove then re-add records to fill the new secondary indexes.
   ///
   /// Don't do any of the following; these will corrupt data:
   /// - Don't modify any type marked `definitionWillNotChange()`
   /// - Don't remove `definitionWillNotChange()` from a type; this changes its serialization format
   /// - Don't add new fields to the middle of `T` or any types that it contains
   /// - Don't add new non-optional fields to `T` or any types that it contains
   /// - Don't reorder fields within `T` or any types that it contains
   /// - Don't remove fields from `T` or any types that it contains
   /// - Don't change the types of fields within `T` or any types that it contains
   /// - Don't reorder secondary indexes
   /// - Don't remove secondary indexes
   ///
   /// #### Data format
   ///
   /// The key-value pairs have this format:
   ///
   /// | Usage | Key | Value |
   /// | ----  | --- | ----- |
   /// | primary index | prefix, 0, primary key | object data |
   /// | secondary index | prefix, i, secondary key | prefix, 0, primary key |
   ///
   /// Each secondary index is numbered `1 <= i <= 255` above. The secondary indexes
   /// point to the primary index.
   ///
   /// `Table` serializes keys using `psio::to_key`. It serializes `T` using fracpack.
   template <typename T, auto Primary, auto... Secondary>
   class Table
   {
     public:
      static_assert(1 + sizeof...(Secondary) <= 255, "Too many indices");
      using key_type   = std::remove_cvref_t<decltype(std::invoke(Primary, std::declval<T>()))>;
      using value_type = T;

      /// Construct table with prefix
      ///
      /// The prefix separates this table's data from other tables; see [Data format](#data-format).
      ///
      /// This version of the constructor copies the data within `prefix`.
      Table(DbId db, KeyView prefix) : db(db), prefix(prefix.data.begin(), prefix.data.end()) {}

      /// Construct table with prefix
      ///
      /// The prefix separates this table's data from other tables; see [Data format](#data-format).
      Table(DbId db, std::vector<char>&& prefix) : db(db), prefix(std::move(prefix)) {}

      /// Store `value` into the table
      ///
      /// If an object already exists with the same primary key, then the new
      /// object replaces it. If the object has any secondary keys which
      /// have the same value as another object, but not the one it's replacing,
      /// then `put` aborts the transaction.
      void put(const T& value)
      {
         auto pk = serialize_key(0, std::invoke(Primary, value));
         if constexpr (sizeof...(Secondary) > 0)
         {
            int               sz         = raw::kvGet(db, pk.data(), pk.size());
            std::vector<char> key_buffer = prefix;
            key_buffer.push_back(0);
            if (sz != -1)
            {
               std::vector<char> buffer(sz);
               raw::getResult(buffer.data(), buffer.size(), 0);
               auto data              = psio::convert_from_frac<T>(std::move(buffer));
               auto replace_secondary = [&](uint8_t& idx, auto wrapped)
               {
                  auto old_key = std::invoke(decltype(wrapped)::value, data);
                  auto new_key = std::invoke(decltype(wrapped)::value, value);
                  if (old_key != new_key)
                  {
                     key_buffer.back() = idx;
                     psio::convert_to_key(old_key, key_buffer);
                     raw::kvRemove(db, key_buffer.data(), key_buffer.size());
                     key_buffer.resize(prefix.size() + 1);
                     psio::convert_to_key(new_key, key_buffer);
                     kvInsertUnique(db, key_buffer.data(), key_buffer.size(), pk.data(), pk.size());
                     key_buffer.resize(prefix.size() + 1);
                  }
                  ++idx;
               };
               uint8_t idx = 1;
               (replace_secondary(idx, wrap<Secondary>()), ...);
            }
            else
            {
               auto write_secondary = [&](uint8_t& idx, auto wrapped)
               {
                  auto key          = std::invoke(decltype(wrapped)::value, value);
                  key_buffer.back() = idx;
                  psio::convert_to_key(key, key_buffer);
                  kvInsertUnique(db, key_buffer.data(), key_buffer.size(), pk.data(), pk.size());
                  key_buffer.resize(prefix.size() + 1);
                  ++idx;
               };
               std::uint8_t idx = 1;
               (write_secondary(idx, wrap<Secondary>()), ...);
            }
         }
         auto serialized = psio::convert_to_frac(value);
         raw::kvPut(db, pk.data(), pk.size(), serialized.data(), serialized.size());
      }

      /// Remove `key` from table
      ///
      /// This is equivalent to looking an object up by the key, then
      /// calling [remove] if found. The key must be the primary key.
      template <compatible_key<key_type> Key>
      void erase(Key&& key)
      {
         if constexpr (sizeof...(Secondary) == 0)
         {
            auto key_buffer = serialize_key(0, key);
            raw::kvRemove(db, key_buffer.data(), key_buffer.size());
         }
         else
         {
            if (auto value = getIndex<0>().get(key))
            {
               remove(*value);
            }
         }
      }

      /// Remove object from table
      void remove(const T& oldValue)
      {
         std::vector<char> key_buffer = prefix;
         key_buffer.push_back(0);
         auto erase_key = [&](std::uint8_t& idx, auto wrapped)
         {
            auto key          = std::invoke(decltype(wrapped)::value, oldValue);
            key_buffer.back() = idx;
            psio::convert_to_key(key, key_buffer);
            raw::kvRemove(db, key_buffer.data(), key_buffer.size());
            key_buffer.resize(prefix.size() + 1);
            ++idx;
         };
         std::uint8_t idx = 0;
         erase_key(idx, wrap<Primary>());
         (erase_key(idx, wrap<Secondary>()), ...);
      }

      // TODO: get index by name
      /// Get a primary or secondary index
      ///
      /// If `Idx` is 0, then this returns the primary index, else it returns
      /// a secondary index.
      ///
      /// The result is [TableIndex].
      template <int Idx>
      auto getIndex() const
      {
         using key_extractor =
             boost::mp11::mp_at_c<boost::mp11::mp_list<wrap<Primary>, wrap<Secondary>...>, Idx>;
         using key_type =
             std::remove_cvref_t<decltype(std::invoke(key_extractor::value, std::declval<T>()))>;
         auto index_prefix = prefix;
         index_prefix.push_back(static_cast<char>(Idx));
         return TableIndex<T, key_type>(db, std::move(index_prefix), Idx > 0);
      }

     private:
      std::vector<char> serialize_key(uint8_t idx, auto&& k)
      {
         KeyView key_base{{prefix.data(), prefix.size()}};
         return psio::convert_to_key(std::tie(key_base, idx, k));
      }
      DbId              db;
      std::vector<char> prefix;
   };

   // TODO: allow tables to be forward declared.  The simplest method is:
   // struct xxx : Table<...> {};
   /// Defines the set of tables in a service
   ///
   /// Template arguments:
   /// - `Tables`: one or more [Table] types; one for each table the service supports.
   ///
   /// #### Modifying table set
   ///
   /// You may add additional tables at the end.
   ///
   /// Don't do any of the following; these will corrupt data:
   /// - Don't remove any tables
   /// - Don't reorder the tables
   ///
   /// #### Prefix format
   ///
   /// `ServiceTables` gives each table the following prefix. See [Data format](#data-format).
   ///
   /// | Field | Size | Description |
   /// | ----- | ---- | ----------- |
   /// | account | 64 bits | Service account |
   /// | table | 16 bits | Table number. First table is 0. |
   template <typename... Tables>
   struct ServiceTables
   {
      /// Constructor
      ///
      /// `account` is the account the service runs on.
      explicit constexpr ServiceTables(AccountNumber account) : account(account) {}

      /// Open by table number
      ///
      /// This gets a table by number. The first table is 0.
      ///
      /// e.g. `auto table = MyServiceTables{myServiceAccount}.open<2>();`
      ///
      /// Returns a [Table].
      template <std::uint16_t Table>
      auto open() const
      {
         std::vector<char> key_prefix = psio::convert_to_key(std::tuple(account, Table));
         return boost::mp11::mp_at_c<boost::mp11::mp_list<Tables...>, Table>(DbId::service,
                                                                             std::move(key_prefix));
      }

      /// Open by table type
      ///
      /// This gets a table by the table's type.
      ///
      /// e.g. `auto table = MyServiceTables{myServiceAccount}.open<MyTable>();`
      ///
      /// Returns a [Table].
      template <typename T>
      auto open() const
      {
         return open<boost::mp11::mp_find<boost::mp11::mp_list<Tables...>, T>::value>();
      }

      AccountNumber account;  ///< the service runs on this account
   };
}  // namespace psibase
