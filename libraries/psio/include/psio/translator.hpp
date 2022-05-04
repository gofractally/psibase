#pragma once
#include <psio/from_bin.hpp>
#include <psio/from_json.hpp>
#include <psio/from_protobuf.hpp>
#include <psio/protobuf/json.hpp>
#include <psio/fracpack.hpp>
#include <psio/protobuf/schema.hpp>
#include <psio/schema.hpp>
#include <psio/to_bin.hpp>
#include <psio/to_json.hpp>
#include <psio/to_protobuf.hpp>

namespace psio
{

   class meta_type_base
   {
     public:
      meta_type_base(uint32_t n) : _number(n) {}

      virtual ~meta_type_base() {}
      virtual const char* name() const = 0;

      virtual std::vector<char> json_to_frac(std::string json) const     = 0;
      virtual std::vector<char> json_to_protobuf(std::string json) const = 0;
      virtual std::vector<char> json_to_bin(std::string json) const      = 0;

      virtual std::vector<char> protobuf_to_frac(const std::vector<char>& b) const = 0;
      virtual std::string       protobuf_to_json(const std::vector<char>& b) const = 0;
      virtual std::vector<char> protobuf_to_bin(const std::vector<char>& b) const  = 0;

      virtual std::string       frac_to_json(const std::vector<char>& b) const     = 0;
      virtual std::vector<char> frac_to_protobuf(const std::vector<char>& b) const = 0;
      virtual std::vector<char> frac_to_bin(const std::vector<char>& b) const      = 0;

      virtual std::vector<char> bin_to_protobuf(const std::vector<char>& b) const = 0;
      virtual std::string       bin_to_json(const std::vector<char>& b) const     = 0;
      virtual std::vector<char> bin_to_frac(const std::vector<char>& b) const     = 0;

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

      virtual std::vector<char> json_to_protobuf(std::string json) const override 
      {
         auto t = convert_from_json<T>(json);
         return to_protobuf(t);
      }

      virtual std::vector<char> json_to_bin(std::string json) const override
      {
         auto t = convert_from_json<T>(json);
         return convert_to_bin(t);
      }

      virtual std::string protobuf_to_json(const std::vector<char>& b) const override
      {
         auto t = from_protobuf<T>(b);
         return convert_to_json(t);
      }

      virtual std::vector<char> protobuf_to_bin(const std::vector<char>& b) const override
      {
         auto t = from_protobuf<T>(b);
         return convert_to_bin(t);
      }
      virtual std::vector<char> protobuf_to_frac(const std::vector<char>& b) const override
      {
         auto t = from_protobuf<T>(b);
         return to_frac(t);
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

      virtual std::vector<char> frac_to_protobuf(const std::vector<char>& b) const override
      {
         auto t = from_frac<T>(b);
         return to_protobuf(t);
      }



      virtual std::vector<char> bin_to_protobuf(const std::vector<char>& b) const override
      {
         auto t = convert_from_bin<T>(b);
         return to_protobuf(t);
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
      string get_protobuf_schema() { return to_protobuf_schema(_schema); }
      string get_gql_schema()const;

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

      std::vector<char> json_to_protobuf(int type_num, std::string json) const
      {
         if (type_num < _types.size())
            return _types[type_num]->json_to_protobuf(json);
         return std::vector<char>();
      }

      string frac_to_json(int type_num, const std::vector<char>& frac) const
      {
         if ((size_t)type_num < _types.size())
            return _types[type_num]->frac_to_json(frac);
         return string();
      }
      std::vector<char> frac_to_protobuf(int type_num, const std::vector<char>& frac) const
      {
         if (type_num < _types.size())
            return _types[type_num]->frac_to_protobuf(frac);
         return {};
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
      std::vector<char> bin_to_protobuf(int type_num, const std::vector<char>& bin) const
      {
         if (type_num < _types.size())
            return _types[type_num]->bin_to_protobuf(bin);
         return std::vector<char>();
      }
      std::vector<char> bin_to_frac(int type_num, const std::vector<char>& bin) const
      {
         if (type_num < _types.size())
            return _types[type_num]->bin_to_frac(bin);
         return std::vector<char>();
      }

      string protobuf_to_json(int type_num, const std::vector<char>& pbuf) const
      {
         if (type_num < _types.size())
            return _types[type_num]->protobuf_to_json(pbuf);
         return string();
      }
      std::vector<char> protobuf_to_bin(int type_num, const std::vector<char>& pbuf) const
      {
         if (type_num < _types.size())
            return _types[type_num]->protobuf_to_bin(pbuf);
         return std::vector<char>();
      }
      std::vector<char> protobuf_to_frac(int type_num, const std::vector<char>& pbuf) const
      {
         if (type_num < _types.size())
            return _types[type_num]->protobuf_to_frac(pbuf);
         return std::vector<char>();
      }

      string query_protobuf_to_json(const std::vector<char>& pbuf_query) const
      {
         psio::input_stream in(pbuf_query.data(), pbuf_query.size());
         auto               pbquery = psio::from_protobuf<protobuf::query>(in);
         auto               jquery  = protobuf::to_json_query<T>(pbquery);
         return to_json(jquery);
      }

      std::vector<char> query_json_to_protobuf(string json_query) const
      {
         auto jq  = convert_from_json<psio::protobuf::json_query>(std::move(json_query));
         auto pbq = psio::protobuf::from_json_query<T>(jq);
         return to_protobuf(pbq);
      }

      //     string query_protobuf_to_gql( const byte_view& pbuf_query );
      //     string query_json_to_gql( const string_view& json_query );
      //      string query_gql_to_protobuf( const string_view& gql_query );
      //      string query_gql_to_josn( const string_view& gql_query );
     private:
      schema                       _schema;
      std::vector<meta_type_base*> _types;
   };

   template <typename T, typename InStream, typename OutStream>
   void translate_json_to_protobuf(uint32_t number, InStream& in, OutStream& out)
   {
      varuint32 key;
      key.value = number << 3;
      if constexpr (std::is_same_v<varuint32, T>)
      {
         // wiretype 0
      }
      else if constexpr (sizeof(T) == 8)
         key.value |= uint8_t(protobuf::fixed64);
      else if constexpr (sizeof(T) == 4)
         key.value |= uint8_t(protobuf::fixed32);
      T r;
      from_json(r, in);
      to_bin(key, out);
      to_bin(r, out);
   }

   template <typename InStream, typename OutStream>
   bool translate_json_to_protobuf(const schema&      sch,
                                   const std::string& pbuf_type,
                                   InStream&          in,
                                   OutStream&         out)
   {
      auto otype = sch.get_object(pbuf_type);
      if (not otype)
      {
         auto vtype = sch.get_vector(pbuf_type);
         if (vtype)
         {
         }
         return false;
      }
      in.get_start_object();
      auto t = in.peek_token();
      while (t.type != json_token_type::type_end_object)
      {
         std::string_view key    = in.get_key();
         auto             member = otype->get_member_by_name(key);
         if (member)
         {
            if (member->type == "double")
               translate_json_to_protobuf<double>(member->number, in, out);
            else if (member->type == "int64_t")
               translate_json_to_protobuf<int64_t>(member->number, in, out);
            else if (member->type == "uint64_t")
               translate_json_to_protobuf<uint64_t>(member->number, in, out);
            else if (member->type == "int32_t")
               translate_json_to_protobuf<int32_t>(member->number, in, out);
            else if (member->type == "uint32_t")
               translate_json_to_protobuf<uint32_t>(member->number, in, out);
            else if (member->type == "int16_t")
               translate_json_to_protobuf<int16_t>(member->number, in, out);
            else if (member->type == "uint16_t")
               translate_json_to_protobuf<uint16_t>(member->number, in, out);
            else if (member->type == "int8_t")
               translate_json_to_protobuf<int8_t>(member->number, in, out);
            else if (member->type == "uint8_t")
               translate_json_to_protobuf<uint8_t>(member->number, in, out);
            else if (member->type == "bool")
               translate_json_to_protobuf<bool>(member->number, in, out);
            else if (member->type == "char")
               translate_json_to_protobuf<char>(member->number, in, out);
            else if (member->type == "varuint32")
               translate_json_to_protobuf<varuint32>(member->number, in, out);
            else
            {
               auto st = sch.get_type(member->type);
               if (not st)
                  from_json_skip_value(in);
               else if (object_type* obj = std::get_if<object_type>(&*st))
               {
                  /// wire_type == wire_type_enum::buffer
               }
               else if (vector_type* obj = std::get_if<vector_type>(&*st))
               {
                  /// wire_type == wire_type_enum::buffer
               }
               else if (variant_type* obj = std::get_if<variant_type>(&*st))
               {
                  /// wire_type == wire_type_enum::buffer
               }
               else if (tuple_type* obj = std::get_if<tuple_type>(&*st))
               {
                  /// wire_type == wire_type_enum::buffer
               }
            }
            /*
                translate_json_to_protobuf( sch, member->type, in, out );
                auto t = in.peek_token();
                switch( t.type ) {
                    case json_token_type::type_string:
                    case json_token_type::type_null:
                    case json_token_type::type_bool:
                    case json_token_type::type_start_object:
                    case json_token_type::type_start_array:
                }
                */
         }
         else
         {
            from_json_skip_value(in);
         }
      }
   }

   template <typename InStream, typename OutStream>
   bool translate_protobuf_to_json(const schema&      sch,
                                   const std::string& pbuf_type,
                                   InStream&          in,
                                   OutStream&         out)
   {
      using namespace psio::protobuf;
      auto otype = sch.get_object(pbuf_type);
      if (not otype)
      {
         auto vtype = sch.get_vector(pbuf_type);
         if (vtype)
         {
            out.write('[');
            bool first = true;

            while (in.remaining())
            {
               uint32_t key = 0;
               varuint32_from_bin(key, in);
               wire_type_enum type = wire_type_enum(uint8_t(key) & 0x07);
               //uint32_t number = key >> 3;

               auto contained_type = vtype->type;

               if (first)
               {
                  first = false;
               }
               else
               {
                  out.write(',');
               }

               switch (type)
               {
                  case wire_type_enum::varint:
                  {
                     varuint32 val;
                     from_bin(val, in);
                     if (contained_type == "bool")
                        to_json(bool(val.value), out);
                     else
                        to_json(val.value, out);
                  }
                  break;
                  case wire_type_enum::fixed64:
                  {
                     int64_t val;
                     from_bin(val, in);
                     if (contained_type == "double")
                        to_json(*((double*)&val), out);
                     else
                        to_json(val, out);
                  }
                  break;
                  case wire_type_enum::buffer:
                  {
                     if (contained_type == "string")
                     {
                        std::string val;
                        from_bin(val, in);
                        to_json(val, out);
                     }
                     else if (contained_type == "bytes")
                     {
                        bytes val;
                        from_bin(val, in);
                        to_json(val, out);
                     }
                     else
                     {
                        varuint32 size;
                        from_bin(size, in);
                        if (size.value > in.remaining())
                           return false;
                        input_stream obj_in(in.pos, in.pos + size);
                        translate_protobuf_to_json(sch, contained_type, obj_in, out);
                        in.skip(size);
                     }
                  }
                  break;
                  case wire_type_enum::fixed32:
                  {
                     int32_t val;
                     from_bin(val, in);
                     if (contained_type == "float")
                        to_json(*((float*)&val), out);
                     else
                        to_json(val, out);
                  }
                  break;
               };
            }

            out.write(']');
            return true;
         }
         return false;
      }

      out.write('{');
      bool first = true;
      while (in.remaining())
      {
         uint32_t key = 0;
         varuint32_from_bin(key, in);
         wire_type_enum type   = wire_type_enum(uint8_t(key) & 0x07);
         uint32_t       number = key >> 3;

         //std::cout <<"field number: " << number <<"  type: " << int64_t(type)<<"  ";
         auto member_meta = otype->get_member_by_number(number);

         if (first)
         {
            first = false;
         }
         else
         {
            out.write(',');
         }

         if (member_meta)
         {
            to_json(member_meta->name, out);
         }
         else
         {
            to_json(std::to_string(number), out);
         }

         out.write(':');

         switch (type)
         {
            case wire_type_enum::varint:
            {
               varuint32 val;
               from_bin(val, in);
               if (member_meta->type == "bool")
                  to_json(bool(val.value), out);
               else
                  to_json(val.value, out);
            }
            break;
            case wire_type_enum::fixed64:
            {
               int64_t val;
               from_bin(val, in);
               if (member_meta->type == "double")
                  to_json(*((double*)&val), out);
               else
                  to_json(val, out);
            }
            break;
            case wire_type_enum::buffer:
            {
               if (member_meta->type == "string")
               {
                  std::string val;
                  from_bin(val, in);
                  to_json(val, out);
               }
               else if (member_meta->type == "bytes")
               {
                  bytes val;
                  from_bin(val, in);
                  to_json(val, out);
               }
               else
               {
                  varuint32 size;
                  from_bin(size, in);
                  if (size.value > in.remaining())
                     return false;
                  input_stream obj_in(in.pos, in.pos + size);
                  translate_protobuf_to_json(sch, member_meta->type, obj_in, out);
                  in.skip(size);
               }
               //   a.members.emplace_back( number, std::move(val) );
            }
            break;
            case wire_type_enum::fixed32:
            {
               int32_t val;
               from_bin(val, in);
               if (member_meta->type == "float")
                  to_json(*((float*)&val), out);
               else
                  to_json(val, out);
            }
            break;
         };
      }
      out.write('}');
      return true;
   }
   template<typename T>
   string translator<T>::get_gql_schema()const {

      auto transform_type= []( auto s ) {
         if( s == "int32" ) s = "Int";
         if( s == "int32[]" ) s = "Int[]";
         if( s == "int32?" ) s = "Int?";
         if( s == "string" ) s = "String";
         if( s == "string[]" ) s = "String[]";
         if( s == "string?" ) s = "String?";
         if( s.back() == ']' ) {
            if( s.size() > 3 ) {
               if( s[s.size()-3] == '?' )
                  return '[' + s.substr(0,s.size()-3)+"]!";
               else
                  return '[' + s.substr(0,s.size()-2)+"!]!";
            }
            return '[' + s.substr(0,s.size()-2)+"]!";
         }
         if( s.back() == '?' )
            return s.substr(0,s.size()-1);
         return s +"!";
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

      for( auto& items : _schema.types ) {
        std::visit( [&]( auto i ){
          if constexpr( std::is_same_v<decltype(i),object_type> ) {
        ss << "type " << items.first << " { \n";
              for( auto member : i.members ) {
                  ss << "   " << member.name;
                  if( member.params.size() ) {
                     ss<<"(";
                        int first = 0;
                        for( auto param : member.params ) {
                          if( first++ )
                             ss << ", ";
                          ss << param.name << ": " << transform_type(param.type);
                        }
                     ss<<")";
                  }

                  ss << ": " << transform_type(member.type) <<"  @psibase( index:" << member.number <<" )";
                  ss <<"\n"; 


              }
        ss << "}\n\n";
          } else {
        //      ss << "   other\n";
          }
        }, items.second );
      }
      return ss.str();
   }

};  // namespace psio
