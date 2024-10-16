#pragma once

#include <string_view>
#include <tuple>
#include <vector>

namespace psibase::cli
{

   inline void store(std::string_view* loc, std::string_view value)
   {
      *loc = value;
   }

   inline void store(std::vector<std::string_view>* loc, std::string_view value)
   {
      loc->push_back(value);
   }

   template <typename T>
   struct OptionMatch;

   template <>
   struct OptionMatch<char>
   {
      using type = OptionMatch<char>;
      char ch;
      bool matches(std::string_view arg) const
      {
         return arg.size() >= 2 && arg[0] == '-' && arg[1] == ch;
      }
      std::size_t offset(std::string_view arg) const
      {
         if (arg.size() > 2)
            return 2;
         else
            return 0;
      }
   };

   template <>
   struct OptionMatch<std::string_view>
   {
      using type = OptionMatch<std::string_view>;
      std::string_view name;
      bool             matches(std::string_view arg) const
      {
         return arg.size() >= (name.size() + 2) && arg[0] == '-' && arg[1] == '-' &&
                arg.substr(2).starts_with(name) &&
                (arg.size() == name.size() + 2 || arg[name.size() + 2] == '=');
      }
      std::size_t offset(std::string_view arg) const
      {
         if (arg.size() > name.size() + 2)
            return name.size() + 3;
         else
            return 0;
      }
   };

   template <>
   struct OptionMatch<const char*>
   {
      using type = OptionMatch<std::string_view>;
   };

   template <typename T, typename Iter, typename Value>
   bool match(const OptionMatch<T>& opt, Iter& pos, Iter end, Value* out)
   {
      std::string_view key = *pos;
      if (opt.matches(key))
      {
         if (auto offset = opt.offset(key))
            store(out, key.substr(offset));
         else
         {
            ++pos;
            if (pos == end)
               return false;
            store(out, *pos);
         }
         ++pos;
         return true;
      }
      return false;
   }

   template <typename T, typename Iter>
   bool match(const OptionMatch<T>& opt, Iter& pos, Iter end, bool* out)
   {
      std::string_view key = *pos;
      if (opt.matches(key))
      {
         if (auto offset = opt.offset(key))
         {
            auto value = key.substr(offset);
            if (value == "true" || value == "on" || value == "yes" || value == "1")
               *out = true;
            else if (value == "false" || value == "off" || value == "no" || value == "0")
               *out = false;
            else
               return false;
         }
         else
         {
            *out = true;
         }
         ++pos;
         return true;
      }
      return false;
   }

   template <typename T, typename Iter, std::size_t... I, typename Value>
   bool match_impl(T&& t, Iter& pos, Iter end, std::index_sequence<I...>, Value* out)
   {
      Iter original = pos;
      return ((pos == original && match(std::get<I>(t), pos, end, out)) || ...);
   }

   template <typename Value, typename... Names>
   struct Option
   {
      Option(Value* out, Names... names) : names(names...), out(out) {}
      std::tuple<typename OptionMatch<Names>::type...> names;
      Value*                                           out;
      bool                                             match(auto& pos, auto end)
      {
         return match_impl(names, pos, end, std::make_index_sequence<sizeof...(Names)>{}, out);
      }
   };

   template <std::size_t N>
   struct PositionalOptions
   {
      std::string_view* items[N];
      std::size_t       idx = 0;
      bool              match(const char* const*& pos, const char* const* end)
      {
         std::string_view item = *pos;
         if (!item.starts_with('-'))
         {
            if (idx < N)
            {
               *items[idx++] = item;
               ++pos;
               return true;
            }
         }
         else if (item == "--")
         {
            ++pos;
            while (idx < N && pos < end)
            {
               *items[idx++] = *pos++;
            }
            if (pos < end && idx == N)
               return false;
            return true;
         }
         return false;
      }
   };

   template <typename... T>
   PositionalOptions(T*...) -> PositionalOptions<sizeof...(T)>;

   template <typename Opts, std::size_t... I>
   bool parse_one(const char* const*& pos,
                  const char* const*  end,
                  Opts&&              opts,
                  std::index_sequence<I...>)
   {
      auto original = pos;
      return ((pos == original && std::get<I>(opts).match(pos, end)) || ...);
   }

   template <typename Opts>
   bool parse(int argc, const char* const* argv, Opts&& opts)
   {
      if (argc == 1)
         return false;
      const char* const* pos = argv + 1;
      const char* const* end = argv + argc;
      while (pos != end)
      {
         if (!parse_one(pos, end, opts,
                        std::make_index_sequence<std::tuple_size_v<std::remove_cvref_t<Opts>>>{}))
         {
            if (pos == end)
               std::cerr << "Expected value for " << pos[-1] << std::endl;
            else
               std::cerr << "Unexpected argument: " << *pos << std::endl;
            return false;
         }
      }
      return true;
   }
}  // namespace psibase::cli
