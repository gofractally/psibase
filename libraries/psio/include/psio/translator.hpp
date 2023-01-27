#pragma once
#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/from_json.hpp>
#include <psio/schema.hpp>
#include <psio/to_bin.hpp>
#include <psio/to_json.hpp>

#include <sstream>

namespace psio
{

   class meta_type_base
   {
     public:
      meta_type_base(uint32_t n) : _number(n) {}

      virtual ~meta_type_base() {}
      virtual const char* name() const = 0;

      virtual std::vector<char> json_to_frac(std::string json) const = 0;
      virtual std::vector<char> json_to_bin(std::string json) const  = 0;

      virtual std::string       frac_to_json(const std::vector<char>& b) const = 0;
      virtual std::vector<char> frac_to_bin(const std::vector<char>& b) const  = 0;

      virtual std::string       bin_to_json(const std::vector<char>& b) const = 0;
      virtual std::vector<char> bin_to_frac(const std::vector<char>& b) const = 0;

      uint32_t number() const { return _number; }

     private:
      uint32_t _number;
   };

   template <typename T>
   class meta_type : public meta_type_base
   {
     public:
      meta_type(uint32_t n) : meta_type_base(n) {}
      virtual ~meta_type(){};

      virtual const char* name() const override
      {
         return get_type_name<T>();  //reflect<T>::name();
      }

      virtual std::vector<char> json_to_frac(std::string json) const override
      {
         auto t = convert_from_json<T>(json);
         return to_frac(t);
      }

      virtual std::vector<char> json_to_bin(std::string json) const override
      {
         auto t = convert_from_json<T>(json);
         return convert_to_bin(t);
      }

      virtual std::string frac_to_json(const std::vector<char>& b) const override
      {
         auto t = from_frac<T>(b);
         return convert_to_json(t);
      }

      virtual std::vector<char> frac_to_bin(const std::vector<char>& b) const override
      {
         auto t = from_frac<T>(b);
         return convert_to_bin(t);
      }

      virtual std::vector<char> bin_to_frac(const std::vector<char>& b) const override
      {
         auto t = convert_from_bin<T>(b);
         return to_frac(t);
      }

      virtual std::string bin_to_json(const std::vector<char>& b) const override
      {
         auto t = convert_from_bin<T>(b);
         return convert_to_json(t);
      }
   };

   template <typename T>
   class translator
   {
     public:
      translator()
      {
         _schema.generate<T>(
             [&](auto* p)
             { _types.push_back(new meta_type<std::decay_t<decltype(*p)>>(_types.size())); });
      }
      string get_json_schema() const { return format_json(_schema); }
      string get_gql_schema() const;

      uint32_t get_type_num(const string& type_name) const
      {
         for (const auto& t : _types)
            if (t->name() == type_name)
               return t->number();
         return -1;
      }

      string get_type_name(uint32_t type_num) const
      {
         if (type_num < _types.size())
            return _types[type_num]->name();
         return string();
      }

      std::vector<char> json_to_frac(uint32_t type_num, std::string json) const
      {
         if (type_num < _types.size())
            return _types[type_num]->json_to_frac(json);
         return std::vector<char>();
      }

      std::vector<char> json_to_bin(uint32_t type_num, std::string json) const
      {
         if (type_num < _types.size())
            return _types[type_num]->json_to_bin(json);
         return std::vector<char>();
      }

      string frac_to_json(int type_num, const std::vector<char>& frac) const
      {
         if ((size_t)type_num < _types.size())
            return _types[type_num]->frac_to_json(frac);
         return string();
      }
      std::vector<char> frac_to_bin(int type_num, const std::vector<char>& frac) const
      {
         if (type_num < _types.size())
            return _types[type_num]->frac_to_bin(frac);
         return std::vector<char>();
      }

      string bin_to_json(int type_num, const std::vector<char>& bin) const
      {
         if (type_num < _types.size())
            return _types[type_num]->bin_to_json(bin);
         return string();
      }
      std::vector<char> bin_to_frac(int type_num, const std::vector<char>& bin) const
      {
         if (type_num < _types.size())
            return _types[type_num]->bin_to_frac(bin);
         return std::vector<char>();
      }

      //     string query_json_to_gql( const string_view& json_query );
      //      string query_gql_to_josn( const string_view& gql_query );
     private:
      schema                       _schema;
      std::vector<meta_type_base*> _types;
   };

   template <typename T>
   string translator<T>::get_gql_schema() const
   {
      auto transform_type = [](auto s)
      {
         if (s == "int32")
            s = "Int";
         if (s == "int32[]")
            s = "Int[]";
         if (s == "int32?")
            s = "Int?";
         if (s == "string")
            s = "String";
         if (s == "string[]")
            s = "String[]";
         if (s == "string?")
            s = "String?";
         if (s.back() == ']')
         {
            if (s.size() > 3)
            {
               if (s[s.size() - 3] == '?')
                  return '[' + s.substr(0, s.size() - 3) + "]!";
               else
                  return '[' + s.substr(0, s.size() - 2) + "!]!";
            }
            return '[' + s.substr(0, s.size() - 2) + "]!";
         }
         if (s.back() == '?')
            return s.substr(0, s.size() - 1);
         return s + "!";
      };

      std::stringstream ss;
      ss << "directive @psibase( \n";
      ss << "   index: Int \n";
      ss << "   final: Boolean\n";
      ss << ") on FIELD_DEFINITION\n\n";
      ss << "scalar Int64\n";
      ss << "scalar UInt64\n";
      ss << "scalar UInt32\n";
      ss << "scalar UInt16\n";
      ss << "scalar UInt8\n";
      ss << "scalar Int64\n";
      ss << "scalar Int16\n";
      ss << "scalar Int8\n";
      ss << "scalar Char\n";

      for (auto& items : _schema.types)
      {
         std::visit(
             [&](auto i)
             {
                if constexpr (std::is_same_v<decltype(i), object_type>)
                {
                   ss << "type " << items.first << " { \n";
                   for (auto member : i.members)
                   {
                      ss << "   " << member.name;
                      if (member.params.size())
                      {
                         ss << "(";
                         int first = 0;
                         for (auto param : member.params)
                         {
                            if (first++)
                               ss << ", ";
                            ss << param.name << ": " << transform_type(param.type);
                         }
                         ss << ")";
                      }

                      ss << ": " << transform_type(member.type)
                         << "  @psibase( index:" << member.number << " )";
                      ss << "\n";
                   }
                   ss << "}\n\n";
                }
                else
                {
                   //      ss << "   other\n";
                }
             },
             items.second);
      }
      return ss.str();
   }

};  // namespace psio
