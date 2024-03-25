#pragma once

#include <concepts>
#include <map>
#include <psio/fracpack.hpp>
#include <psio/to_json.hpp>
#include <psio/to_json/map.hpp>
#include <variant>

namespace psio
{
   template <typename T>
      requires Packable<std::remove_cv_t<T>>
   class shared_view_ptr;

   struct FracStream
   {
      FracStream(std::span<const char> buf) : src(buf.data())
      {
         check(buf.size() <= std::numeric_limits<std::uint32_t>::max(),
               "fracpack buffer too large");
         end_pos = static_cast<std::uint32_t>(buf.size());
      }
      const char*   src;
      std::uint32_t pos = 0;
      std::uint32_t end_pos;
      bool          has_unknown = false;
      bool          known_end   = true;
   };

   class StreamBase
   {
     public:
      void        write(const void* data, std::size_t size) { do_write(data, size); }
      void        write(char ch) { do_write(&ch, 1); }
      friend void increase_indent(StreamBase& self) { self.do_increase_indent(); }
      friend void decrease_indent(StreamBase& self) { self.do_decrease_indent(); }
      friend void write_colon(StreamBase& self) { self.do_write_colon(); }
      friend void write_newline(StreamBase& self) { self.do_write_newline(); }

     protected:
      virtual void do_write(const void* data, std::size_t size) = 0;
      virtual void do_increase_indent()                         = 0;
      virtual void do_decrease_indent()                         = 0;
      virtual void do_write_colon()                             = 0;
      virtual void do_write_newline()                           = 0;
      ~StreamBase()                                             = default;
   };

   template <typename T>
   class StreamRef : public StreamBase
   {
     public:
      StreamRef(T& stream) : stream(stream) {}

     protected:
      void do_write(const void* data, std::size_t size) override { stream.write(data, size); }
      void do_increase_indent() override { increase_indent(stream); }
      void do_decrease_indent() override { decrease_indent(stream); }
      void do_write_colon() override { write_colon(stream); }
      void do_write_newline() override { write_newline(stream); }

     private:
      T& stream;
   };

   namespace schema_types
   {

      struct AnyType;

      template <typename T>
      struct Box
      {
         template <std::convertible_to<T> U>
         Box(U&& value) : value(new T(std::forward<U>(value)))
         {
         }
         Box(T&& value) : value(new T(value)) {}
         Box(const Box& other) : value(new T(*other.value)) {}
         Box(Box&&)                          = default;
         Box&               operator=(Box&&) = default;
         T&                 operator*() { return *value; }
         const T&           operator*() const { return *value; }
         T*                 operator->() { return value.get(); }
         const T*           operator->() const { return value.get(); }
         T*                 get() { return value.get(); }
         const T*           get() const { return value.get(); }
         std::unique_ptr<T> value;
      };

      template <typename T, typename Stream>
      void to_json(const Box<T>& wrapper, Stream& stream)
      {
         to_json(*wrapper.value, stream);
      }

      struct Schema
      {
         std::map<std::string, AnyType> types;
         const AnyType*                 get(const std::string& name) const;
         void                           insert(std::string name, AnyType type);
      };
      PSIO_REFLECT(Schema, types)

      struct Member;

      void to_json_members(const std::vector<Member>&, auto& stream);

      struct Object
      {
         std::vector<Member> members;
      };

      PSIO_REFLECT_TYPENAME(Object)

      void to_json(const Object& type, auto& stream)
      {
         to_json_members(type.members, stream);
      }

      struct Struct
      {
         std::vector<Member> members;
      };
      PSIO_REFLECT_TYPENAME(Struct)

      void to_json(const Struct& type, auto& stream)
      {
         to_json_members(type.members, stream);
      }

      struct Array
      {
         Box<AnyType>  type;
         std::uint64_t len;
      };
      PSIO_REFLECT(Array, type, len)

      struct List
      {
         Box<AnyType> type;
      };
      PSIO_REFLECT_TYPENAME(List)

      void to_json(const List& type, auto& stream)
      {
         to_json(*type.type, stream);
      }

      struct Option
      {
         Box<AnyType> type;
      };
      PSIO_REFLECT_TYPENAME(Option)

      void to_json(const Option& type, auto& stream)
      {
         to_json(*type.type, stream);
      }

      struct Custom
      {
         Box<AnyType> type;
         std::string  id;
      };
      PSIO_REFLECT(Custom, type, id)

      struct Int
      {
         std::uint32_t bits;
         bool          isSigned;
      };
      PSIO_REFLECT(Int, bits, isSigned)

      struct Float
      {
         std::uint32_t exp;
         std::uint32_t mantissa;
         friend bool   operator==(const Float&, const Float&) = default;
      };
      PSIO_REFLECT(Float, exp, mantissa)

      struct Variant
      {
         std::vector<Member> members;
      };
      PSIO_REFLECT_TYPENAME(Variant)

      void to_json(const Variant& type, auto& stream)
      {
         to_json_members(type.members, stream);
      }

      struct Tuple
      {
         std::vector<AnyType> members;
      };
      PSIO_REFLECT_TYPENAME(Tuple)

      void to_json(const Tuple& type, auto& stream)
      {
         to_json(type.members, stream);
      }

      struct Type
      {
         std::string type;
      };
      PSIO_REFLECT_TYPENAME(Type)

      void to_json(const Type& type, auto& stream)
      {
         to_json(type.type, stream);
      }

      struct AnyType
      {
         AnyType(Int type) : value(std::move(type)) {}
         AnyType(Float type) : value(std::move(type)) {}
         AnyType(Object type) : value(std::move(type)) {}
         AnyType(Struct type) : value(std::move(type)) {}
         AnyType(Option type) : value(std::move(type)) {}
         AnyType(List type) : value(std::move(type)) {}
         AnyType(Array type) : value(std::move(type)) {}
         AnyType(Variant type) : value(std::move(type)) {}
         AnyType(Tuple type) : value(std::move(type)) {}
         AnyType(Custom type) : value(std::move(type)) {}
         AnyType(Type type) : value(std::move(type)) {}
         AnyType(std::string name) : value(Type{std::move(name)}) {}
         AnyType(const char* name) : value(Type{std::move(name)}) {}
         std::variant<Struct, Object, Array, List, Option, Variant, Tuple, Int, Float, Custom, Type>
                                value;
         mutable const AnyType* resolved = nullptr;
         const AnyType*         resolve(const Schema& schema) const
         {
            if (!resolved)
            {
               const AnyType* result = this;
               while (auto* alias = std::get_if<Type>(&result->value))
               {
                  if (auto* next = schema.get(alias->type))
                  {
                     result = next;
                  }
               }
               resolved = result;
            }
            return resolved;
         }
      };
      PSIO_REFLECT_TYPENAME(AnyType)
      void to_json(const AnyType& type, auto& stream)
      {
         if (auto* alias = std::get_if<Type>(&type.value))
         {
            to_json(*alias, stream);
         }
         else
         {
            to_json(type.value, stream);
         }
      }

      struct Member
      {
         std::string name;
         AnyType     type;
      };
      PSIO_REFLECT(Member, name, type)

      struct CommaList
      {
         bool first = true;
         void next(auto& stream)
         {
            if (first)
               increase_indent(stream);
            else
               stream.write(',');
            write_newline(stream);
            first = false;
         }
         void end(auto& stream)
         {
            if (!first)
            {
               decrease_indent(stream);
               write_newline(stream);
            }
         }
      };

      struct CompiledType;

      struct CustomHandler
      {
         bool (*frac2json)(const CompiledType*, FracStream& in, StreamBase& out);
      };

      template <typename T>
      struct DefaultCustomHandler
      {
         static CustomHandler get() { return {.frac2json = &frac2json}; }
         static bool          frac2json(const CompiledType*, FracStream& in, auto& out)
         {
            T value;
            if (!is_packable<T>::template unpack<true, true>(&value, in.has_unknown, in.known_end,
                                                             in.src, in.pos, in.end_pos))
               return false;
            to_json(value, out);
            return true;
         }
      };

      class CustomTypes
      {
        public:
         template <typename T>
         void insert(std::string name)
         {
            insert(std::move(name), DefaultCustomHandler<T>::get());
         }
         void insert(std::string name, const CustomHandler& t)
         {
            std::size_t index = impl.size();
            impl.push_back(t);
            names.insert({std::move(name), index});
         }
         std::size_t* find(const std::string& name)
         {
            if (auto pos = names.find(name); pos != names.end())
               return &pos->second;
            return nullptr;
         }
         bool frac2json(const CompiledType* type,
                        std::size_t         index,
                        FracStream&         in,
                        auto&               out) const
         {
            StreamRef stream{out};
            return impl[index].frac2json(type, in, stream);
         }

        private:
         std::map<std::string, std::size_t> names;
         std::vector<CustomHandler>         impl;
      };

      struct CompiledMember
      {
         std::uint16_t       fixed_offset;
         bool                is_optional;  // indirect, 1 is empty
         const CompiledType* type;
      };

      struct CompiledType
      {
         enum Kind : std::uint8_t
         {
            scalar,
            struct_,
            object,
            container,
            array,
            variant,
            optional,
         };
         Kind                        kind;
         bool                        is_variable_size;
         std::int16_t                custom_id = -1;
         std::uint32_t               fixed_size;
         std::vector<CompiledMember> children;
         const AnyType*              original_type;
      };

      template <typename T>
      struct BlobImpl
      {
         static bool frac2json(const CompiledType* type, FracStream& in, StreamBase& out)
         {
            if (type->kind == CompiledType::container)
            {
               const auto& member = type->children[0];
               if (!member.is_optional && !member.type->is_variable_size)
               {
                  std::uint32_t size;
                  if (!unpack_numeric<true>(&size, in.src, in.pos, in.end_pos))
                     return false;
                  std::uint32_t end = in.pos + size;
                  if (end > in.end_pos || end < size)
                     return false;
                  T::frac2json(std::span{in.src + in.pos, size}, out);
                  in.pos = end;
                  return true;
               }
            }
            else if (!type->is_variable_size)
            {
               std::uint32_t end = in.pos + type->fixed_size;
               if (end > in.end_pos || end < in.pos)
                  return false;
               T::frac2json(std::span{in.src + in.pos, type->fixed_size}, out);
               in.pos = end;
               return true;
            }
            return false;
         }
      };

      struct OctetStringImpl
      {
         static void frac2json(std::span<const char> in, StreamBase& out)
         {
            psio::to_json_hex(in.data(), in.size(), out);
         }
      };

      inline CustomTypes standard_types()
      {
         CustomTypes result;
         result.insert<bool>("bool");
         result.insert<std::string>("string");
         result.insert("octet-string", {.frac2json = &BlobImpl<OctetStringImpl>::frac2json});
         return result;
      }

      struct CompiledSchema
      {
         CompiledSchema(const Schema& schema, CustomTypes builtin = standard_types())
             : schema(schema), builtin(std::move(builtin))
         {
            // collect root types
            std::vector<const AnyType*> stack;
            for (const auto& [name, type] : schema.types)
            {
               stack.push_back(&type);
            }
            // Process all reachable types
            while (!stack.empty())
            {
               auto top = stack.back();
               stack.pop_back();
               std::visit([&](const auto& t) { add_impl(top, t, stack); }, top->value);
            }
         }
         void add_impl(const AnyType* type, const Object& t, std::vector<const AnyType*>& stack)
         {
            auto [ctype, state] = dfs_discover(type, CompiledType::object, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  for (const auto& member : t.members)
                  {
                     stack.push_back(&member.type);
                  }
                  break;
               case finish:
                  link_impl(t.members, ctype);
                  break;
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const Struct& t, std::vector<const AnyType*>& stack)
         {
            auto [ctype, state] = dfs_discover(type, CompiledType::struct_, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  for (const auto& member : t.members)
                  {
                     stack.push_back(&member.type);
                  }
                  break;
               case finish:
                  ctype->is_variable_size = false;
                  link_impl(t.members, ctype);
                  break;
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const Tuple& t, std::vector<const AnyType*>& stack)
         {
            auto [ctype, state] = dfs_discover(type, CompiledType::object, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  for (const auto& member : t.members)
                  {
                     stack.push_back(&member);
                  }
                  break;
               case finish:
                  for (const auto& member : t.members)
                  {
                     ctype->children.push_back(make_member(
                         get(member.resolve(schema)), ctype->fixed_size, ctype->is_variable_size));
                  }
                  break;
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const Int& t, std::vector<const AnyType*>& stack)
         {
            types.insert({type,
                          {.kind             = CompiledType::scalar,
                           .is_variable_size = false,
                           .fixed_size       = (t.bits + 7) / 8,
                           .original_type    = type}});
         }
         void add_impl(const AnyType* type, const Float& t, std::vector<const AnyType*>& stack)
         {
            types.insert({type,
                          {.kind             = CompiledType::scalar,
                           .is_variable_size = false,
                           .fixed_size       = (t.exp + t.mantissa + 7) / 8,
                           .original_type    = type}});
         }
         void add_impl(const AnyType* type, const Array& t, std::vector<const AnyType*>& stack)
         {
            auto [ctype, state] = dfs_discover(type, CompiledType::array, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  stack.push_back(t.type.get());
                  break;
               case finish:
               {
                  const CompiledType* nested = get(t.type->resolve(schema));
                  ctype->is_variable_size    = nested->is_variable_size;
                  // TODO: handle array of zero-size elements
                  ctype->fixed_size = nested->fixed_size * t.len;
                  ctype->children.push_back({.type = nested});
               }
               break;
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const Option& t, std::vector<const AnyType*>& stack)
         {
            auto [ctype, state] = dfs_discover(type, CompiledType::optional, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  stack.push_back(t.type.get());
                  break;
               case finish:
                  ctype->children.push_back({.type = get(t.type->resolve(schema))});
                  break;
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const List& t, std::vector<const AnyType*>& stack)
         {
            auto [ctype, state] = dfs_discover(type, CompiledType::container, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  stack.push_back(t.type.get());
                  break;
               case finish:
                  ctype->children.push_back({.type = get(t.type->resolve(schema))});
                  break;
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const Variant& t, std::vector<const AnyType*>& stack)
         {
            auto [ctype, state] = dfs_discover(type, CompiledType::variant, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  for (const auto& member : t.members)
                  {
                     stack.push_back(&member.type);
                  }
                  break;
               case finish:
                  for (const auto& member : t.members)
                  {
                     ctype->children.push_back({.type = get(member.type.resolve(schema))});
                  }
                  break;
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const Custom& t, std::vector<const AnyType*>& stack)
         {
            // TODO: check that t.type is structurally equivalent to the
            // builtin.
            auto kind           = static_cast<CompiledType::Kind>(CompiledType::scalar);
            auto [ctype, state] = dfs_discover(type, kind, stack);
            switch (state)
            {
               case start:
                  ctype->is_variable_size = true;
                  stack.push_back(t.type.get());
                  break;
               case finish:
               {
                  CompiledType* child = get(t.type->resolve(schema));
                  // TODO: This is sufficient to prevent crashes, but not to detect all errors
                  if (!child->original_type)
                     check(false, "A Custom type may not depend on itself");
                  ctype->kind             = child->kind;
                  ctype->is_variable_size = child->is_variable_size;
                  ctype->fixed_size       = child->fixed_size;
                  ctype->children         = child->children;
                  if (auto index = builtin.find(t.id))
                     ctype->custom_id = *index;
               }
               default:
                  break;
            }
         }
         void add_impl(const AnyType* type, const Type& t, std::vector<const AnyType*>& stack)
         {
            if (const AnyType* next = schema.get(t.type))
            {
               stack.push_back(next);
            }
            else
            {
               check(false, "undefined type: " + t.type);
            }
         }
         CompiledMember make_member(const CompiledType* mtype,
                                    std::uint32_t&      fixed_size,
                                    bool&               is_variable_size)
         {
            is_variable_size |= mtype->is_variable_size;
            bool is_optional = false;
            if (mtype->kind == CompiledType::optional)
            {
               is_optional = true;
               mtype       = mtype->children[0].type;
            }
            check(fixed_size <= std::numeric_limits<std::uint16_t>::max(), "fixed data too large");
            CompiledMember result{.fixed_offset = static_cast<std::uint16_t>(fixed_size),
                                  .is_optional  = is_optional,
                                  .type         = mtype};
            if (is_optional || mtype->is_variable_size)
               fixed_size += 4;
            else
               fixed_size += mtype->fixed_size;
            return result;
         }
         void link_impl(const std::vector<Member>& members, CompiledType* type)
         {
            for (const auto& member : members)
            {
               type->children.push_back(make_member(get(member.type.resolve(schema)),
                                                    type->fixed_size, type->is_variable_size));
            }
         }
         CompiledType* get(const AnyType* type)
         {
            if (auto pos = types.find(type); pos != types.end())
               return &pos->second;
            return nullptr;
         }
         const CompiledType* get(const AnyType* type) const
         {
            if (auto pos = types.find(type); pos != types.end())
               return &pos->second;
            return nullptr;
         }
         enum VertexEvent
         {
            start,
            finish,
            other,  // For now, we don't need to distinguish these
         };
         // nodes that have been discovered but not completed
         // have original_type == nullptr and fixed_size represents
         // its position on the stack.
         //
         // N.B. When a vertex is completed, its children are guaranteed to be
         // discovered, but may not be completed.
         std::pair<CompiledType*, VertexEvent> dfs_discover(const AnyType*               type,
                                                            CompiledType::Kind           kind,
                                                            std::vector<const AnyType*>& stack)
         {
            if (auto [pos, inserted] =
                    types.insert(std::pair{type, CompiledType{.kind             = kind,
                                                              .is_variable_size = false,
                                                              .original_type    = nullptr}});
                inserted)
            {
               pos->second.fixed_size = stack.size();
               stack.push_back(type);
               return {&pos->second, start};
            }
            else
            {
               if (pos->second.original_type == nullptr && pos->second.fixed_size == stack.size())
               {
                  pos->second.original_type = type;
                  pos->second.fixed_size    = 0;
                  return {&pos->second, finish};
               }
               else
               {
                  return {&pos->second, other};
               }
            }
         }
         const Schema&                          schema;
         CustomTypes                            builtin;
         std::map<const AnyType*, CompiledType> types;
      };

      struct ObjectReader;
      struct OptionReader;
      struct ArrayReader;
      struct VariantReader;

      struct FracParser
      {
         FracParser(std::span<const char> data,
                    const CompiledSchema& schema,
                    const std::string&    type);
         // returns a start token, an end token or a primitive
         enum ItemKind : std::uint16_t
         {
            start,
            end,
            scalar,
            empty,
            custom_start,
         };
         struct Item
         {
            ItemKind              kind;
            std::span<const char> data;
            const CompiledType*   type;
            const AnyType*        parent;
            std::uint32_t         index;
            explicit              operator bool() const { return type != nullptr; }
            Item                  next(FracParser&) { return *this; }
         };
         Item next();
         // Starts parsing the given type at the current pos
         Item parse(const CompiledType* ctype);
         void parse_fixed(Item& result, const CompiledType* ctype, std::uint32_t offset);
         void push(const CompiledType* type, std::uint32_t offset);
         void push_fixed(const CompiledType* type, std::uint32_t offset);
         void check_heap_pos(std::uint32_t pos);
         //
         std::span<const char> read(const CompiledType* type, std::uint32_t offset);
         std::span<const char> read_fixed(const CompiledType* type, std::uint32_t offset);

         void deref(std::uint32_t       fixed_pos,
                    std::uint32_t       end_fixed_pos,
                    const CompiledType* type,
                    bool                is_optional,
                    Item&               result)
         {
            std::uint32_t offset;
            auto          tmp_pos = fixed_pos;
            if (!unpack_numeric<true>(&offset, in.src, tmp_pos, end_fixed_pos))
               check(false, "Cannot read pointer");
            // If the type is an optional
            if (is_optional && offset == 1)
            {
               result.kind = FracParser::empty;
            }
            else
            {
               // validate offset
               std::uint32_t pos = fixed_pos + offset;
               if (pos < offset)
                  check(false, "integer overflow");
               if (type->kind != CompiledType::container || offset != 0)
               {
                  check_heap_pos(pos);
               }
               if (type->custom_id != -1)
               {
                  result.kind = static_cast<ItemKind>(custom_start + type->custom_id);
                  if (offset == 0)
                     result.data = std::span{in.src + fixed_pos, in.src + tmp_pos};
               }
               else if (type->kind == CompiledType::scalar)
               {
                  result.data = read(type, pos);
                  result.kind = FracParser::scalar;
               }
               else
               {
                  push(type, pos);
                  result.kind = FracParser::start;
               }
            }
         }

         using StackItem =
             std::variant<Item, ObjectReader, OptionReader, ArrayReader, VariantReader>;
         FracStream             in;
         const CustomTypes&     builtin;
         std::vector<StackItem> stack;
      };

      struct ObjectReader
      {
         std::uint32_t       start_pos;
         std::uint32_t       index;
         const CompiledType* type;
         FracParser::Item    next(FracParser& parser)
         {
            std::uint16_t fixed_size;
            auto          fixed_pos = start_pos;
            if (type->kind == CompiledType::struct_)
            {
               fixed_size = type->fixed_size;
            }
            else
            {
               (void)unpack_numeric<false>(&fixed_size, parser.in.src, fixed_pos,
                                           parser.in.end_pos);
            }
            if (index == type->children.size())
               // TODO: validate extensions
               return {.kind = FracParser::end, .type = type};
            const auto&      member = type->children[index];
            FracParser::Item result{
                .type = member.type, .parent = type->original_type, .index = index};
            ++index;
            auto fixed_end = fixed_pos + fixed_size;
            fixed_pos += member.fixed_offset;
            if (!member.is_optional && !member.type->is_variable_size)
            {
               if (member.fixed_offset > fixed_size)
                  check(false, "Missing non-optional member");
               if (member.type->fixed_size >
                   static_cast<std::uint16_t>(fixed_size - member.fixed_offset))
                  check(false, "Fixed data too small");
               parser.parse_fixed(result, member.type, fixed_pos);
            }
            else if (member.is_optional && member.fixed_offset >= fixed_size)
            {
               result.kind = FracParser::empty;
            }
            else
            {
               parser.deref(fixed_pos, fixed_end, member.type, member.is_optional, result);
            }
            return result;
         }
      };

      struct OptionReader
      {
         const CompiledType* type;
         bool                completed = false;
         FracParser::Item    next(FracParser& parser)
         {
            if (completed)
               return {.kind = FracParser::end, .type = type};
            else
               completed = true;
            const CompiledType* nested = type->children[0].type;
            FracParser::Item    result{.type = nested, .parent = type->original_type};
            auto                start_pos = parser.in.pos;
            parser.in.pos += 4;
            parser.deref(start_pos, parser.in.end_pos, nested, true, result);
            return result;
         }
      };

      struct ArrayReader
      {
         const CompiledType* type;
         std::uint32_t       pos;
         std::uint32_t       end;
         FracParser::Item    next(FracParser& parser)
         {
            if (pos == end)
            {
               return {.kind = FracParser::end, .type = type};
            }
            const CompiledMember& member = type->children[0];
            FracParser::Item      result{.type = member.type, .parent = type->original_type};
            if (!member.is_optional && !member.type->is_variable_size)
            {
               parser.parse_fixed(result, member.type, pos);
               pos += member.type->fixed_size;
            }
            else
            {
               parser.deref(pos, end, member.type, member.is_optional, result);
               pos += 4;
            }
            return result;
         }
      };

      struct VariantReader
      {
         const CompiledType* type;
         std::uint32_t       old_end_pos = 0;
         FracParser::Item    next(FracParser& parser)
         {
            if (old_end_pos != 0)
            {
               parser.check_heap_pos(old_end_pos);
               parser.in.known_end = true;
               parser.in.end_pos   = old_end_pos;
               return {.kind = FracParser::end, .type = type};
            }
            uint8_t tag;
            if (!unpack_numeric<true>(&tag, parser.in.src, parser.in.pos, parser.in.end_pos))
               check(false, "Cannot unpack variant tag");
            if (tag & 0x80)
               check(false, "Variant tag cannot be greater than 127");
            uint32_t size;
            if (!unpack_numeric<true>(&size, parser.in.src, parser.in.pos, parser.in.end_pos))
               check(false, "Cannot read variant tag");
            auto new_end      = parser.in.pos + size;
            old_end_pos       = parser.in.end_pos;
            parser.in.end_pos = new_end;
            if (tag >= type->children.size())
               check(false, "Variant tag out-of-range");
            auto result   = parser.parse(type->children[tag].type);
            result.parent = type->original_type;
            return result;
         }
      };

      inline FracParser::FracParser(std::span<const char> data,
                                    const CompiledSchema& schema,
                                    const std::string&    type)
          : in(data), builtin(schema.builtin)
      {
         if (auto xtype = schema.schema.get(type))
         {
            auto ctype = schema.get(xtype->resolve(schema.schema));
            check(ctype != 0, "could not find type");

            stack.push_back(parse(ctype));
         }
      }

      inline FracParser::Item FracParser::parse(const CompiledType* ctype)
      {
         Item result{.type = ctype};
         if (ctype->custom_id != -1)
         {
            result.kind = static_cast<ItemKind>(custom_start + ctype->custom_id);
         }
         else if (ctype->kind == CompiledType::scalar)
         {
            result.data = read(ctype, in.pos);
            result.kind = FracParser::scalar;
         }
         else if (ctype->kind == CompiledType::optional)
         {
            result        = OptionReader{ctype}.next(*this);
            result.parent = nullptr;
         }
         else
         {
            push(ctype, in.pos);
            result.kind = FracParser::start;
         }
         return result;
      }

      inline void FracParser::parse_fixed(Item&               result,
                                          const CompiledType* ctype,
                                          std::uint32_t       fixed_pos)
      {
         if (ctype->custom_id != -1)
         {
            result.data = read_fixed(ctype, fixed_pos);
            result.kind = static_cast<ItemKind>(custom_start + ctype->custom_id);
         }
         else if (ctype->kind == CompiledType::scalar)
         {
            result.data = read_fixed(ctype, fixed_pos);
            result.kind = FracParser::scalar;
         }
         else
         {
            push_fixed(ctype, fixed_pos);
            result.kind = FracParser::start;
         }
      }

      inline FracParser::Item FracParser::next()
      {
         if (stack.empty())
            return {};
         auto result = std::visit([this](auto& item) { return item.next(*this); }, stack.back());
         if (result.kind == end || std::holds_alternative<Item>(stack.back()))
         {
            stack.pop_back();
         }
         return result;
      }

      inline void FracParser::push(const CompiledType* type, std::uint32_t offset)
      {
         in.pos = offset;
         switch (type->kind)
         {
            case CompiledType::object:
            case CompiledType::struct_:
            {
               std::uint16_t fixed_size;
               if (type->kind == CompiledType::struct_)
                  fixed_size = type->fixed_size;
               else if (!unpack_numeric<true>(&fixed_size, in.src, in.pos, in.end_pos))
                  check(false, "Failed to read object size");
               auto heap_start = in.pos + fixed_size;
               if (heap_start < in.pos || heap_start > in.end_pos)
                  check(false, "Object fixed data out-of-bounds");
               in.pos = heap_start;
               stack.push_back(ObjectReader{.start_pos = offset, .index = 0, .type = type});
               in.known_end = true;
               break;
            }
            case CompiledType::container:
            {
               // get size
               std::uint32_t size;
               if (!unpack_numeric<true>(&size, in.src, in.pos, in.end_pos))
                  check(false, "Failed to read container size");
               auto heap_start = in.pos + size;
               if (heap_start < in.pos || heap_start > in.end_pos)
                  check(false, "Container size out-of-bounds");
               const CompiledMember& member = type->children[0];
               if (member.is_optional || member.type->is_variable_size)
               {
                  check(size % 4 == 0, "Container size is not an exact number of pointers");
               }
               else
               {
                  check(size % member.type->fixed_size == 0,
                        "Container size is not an exact number of elements");
               }
               auto pos = in.pos;
               in.pos   = heap_start;
               stack.push_back(ArrayReader{.type = type, .pos = pos, .end = heap_start});
               in.known_end = true;
               break;
            }
            case CompiledType::array:
            {
               auto start = offset;
               auto end   = offset + type->fixed_size;
               if (end > in.end_pos || end < offset)
                  check(false, "Array data too large");
               in.pos = end;
               stack.push_back(ArrayReader{.type = type, .pos = start, .end = end});
               break;
            }
            case CompiledType::optional:
            {
               stack.push_back(OptionReader{type});
               in.known_end = true;
               break;
            }
            case CompiledType::variant:
            {
               stack.push_back(VariantReader{type});
               in.known_end = true;
               break;
            }
            default:
               assert(!"Not implemented");
         }
      }
      // \pre range must be valid
      inline void FracParser::push_fixed(const CompiledType* type, std::uint32_t offset)
      {
         switch (type->kind)
         {
            case CompiledType::struct_:
            {
               auto heap_start = in.pos + type->fixed_size;
               if (heap_start < offset || heap_start > in.end_pos)
                  check(false, "Object fixed data out-of-bounds");
               stack.push_back(ObjectReader{.start_pos = offset, .index = 0, .type = type});
               in.known_end = true;
               break;
            }
            case CompiledType::array:
            {
               stack.push_back(
                   ArrayReader{.type = type, .pos = offset, .end = offset + type->fixed_size});
               break;
            }
            default:
               assert(!"Not a fixed size type");
         }
      }

      inline std::span<const char> FracParser::read(const CompiledType* type, std::uint32_t offset)
      {
         in.pos = offset + type->fixed_size;
         check(in.pos <= in.end_pos && in.pos >= offset, "out-of-bounds read");
         return {in.src + offset, type->fixed_size};
      }
      inline std::span<const char> FracParser::read_fixed(const CompiledType* type,
                                                          std::uint32_t       offset)
      {
         // TODO: verify bounds against end of fixed data
         return {in.src + offset, type->fixed_size};
      }

      inline void FracParser::check_heap_pos(std::uint32_t offset)
      {
         if (in.known_end)
            check(in.pos == offset, "wrong offset");
         else
            check(in.pos <= offset, "offset moved backwards");
      }

      struct OpenToken
      {
         char operator()(const Object&) const { return '{'; }
         char operator()(const Variant&) const { return '{'; }
         char operator()(const Struct&) const { return '{'; }
         char operator()(const auto&) const { return '['; }
      };

      struct CloseToken
      {
         char operator()(const Object&) const { return '}'; }
         char operator()(const Variant&) const { return '}'; }
         char operator()(const Struct&) const { return '}'; }
         char operator()(const auto&) const { return ']'; }
      };

      struct MemberName
      {
         const std::string* operator()(const Object& type) const
         {
            return &type.members[index].name;
         }
         const std::string* operator()(const Variant& type) const
         {
            return &type.members[index].name;
         }
         const std::string* operator()(const Struct& type) const
         {
            return &type.members[index].name;
         }
         const std::string* operator()(const auto&) const { return nullptr; }
         std::uint32_t      index;
      };

      template <typename Signed, typename Unsigned, typename Stream>
      void int2json(const Int& type, std::span<const char> in, Stream& out)
      {
         const char*   src     = in.data();
         std::uint32_t pos     = 0;
         std::uint32_t end_pos = static_cast<uint32_t>(in.size());
         if (type.isSigned)
         {
            Signed value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
         else
         {
            Unsigned value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
      }

      void scalar_to_json(const Int& type, std::span<const char> in, auto& out)
      {
         switch (type.bits)
         {
            case 1:
               if (type.isSigned)
               {
                  std::int8_t value = static_cast<std::int8_t>(in[0]);
                  if (value != 0 && value != -1)
                     check(false, "invalid i1");
                  to_json(value, out);
               }
               else
               {
                  std::int8_t value = static_cast<std::uint8_t>(in[0]);
                  if (value != 0 && value != 1)
                     check(false, "invalid u1");
                  to_json(value, out);
               }
               return;
            case 8:
               return int2json<std::int8_t, std::uint8_t>(type, in, out);
            case 16:
               return int2json<std::int16_t, std::uint16_t>(type, in, out);
            case 32:
               return int2json<std::int32_t, std::uint32_t>(type, in, out);
            case 64:
               return int2json<std::int64_t, std::uint64_t>(type, in, out);
            default:
               to_json("<<<Unsupported integer width>>>", out);
         }
      }

      void scalar_to_json(const Float& type, std::span<const char> in, auto& out)
      {
         const char*   src     = in.data();
         std::uint32_t pos     = 0;
         std::uint32_t end_pos = static_cast<uint32_t>(in.size());
         if (type == Float{.exp = 11, .mantissa = 53})
         {
            double value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
         else if (type == Float{.exp = 8, .mantissa = 24})
         {
            float value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
         else
         {
            to_json("<<<Only single and double precision floating point numbers are supported>>>",
                    out);
         }
      }

      void scalar_to_json(const auto&, std::span<const char> in, auto& stream) {}

      void to_json(FracParser& parser, auto& stream)
      {
         std::vector<CommaList> groups;
         auto                   start_member = [&](const auto& item)
         {
            if (!groups.empty())
            {
               groups.back().next(stream);
               if (auto* name = std::visit(MemberName{item.index}, item.parent->value))
               {
                  to_json(*name, stream);
                  write_colon(stream);
               }
            }
         };
         while (auto item = parser.next())
         {
            switch (item.kind)
            {
               case FracParser::start:
                  start_member(item);
                  stream.write(std::visit(OpenToken{}, item.type->original_type->value));
                  groups.emplace_back();
                  break;
               case FracParser::end:
                  groups.back().end(stream);
                  stream.write(std::visit(CloseToken{}, item.type->original_type->value));
                  groups.pop_back();
                  break;
               case FracParser::scalar:
                  start_member(item);
                  std::visit([&](const auto& type) { scalar_to_json(type, item.data, stream); },
                             item.type->original_type->value);
                  break;
               case FracParser::empty:
                  // skip null members
                  //if (groups.empty() ||
                  //    std::visit(MemberName{item.index}, item.parent->value) == nullptr)
                  start_member(item);
                  {
                     stream.write("null", 4);
                  }
                  break;
               default:
                  start_member(item);
                  if (item.data.empty())
                  {
                     if (!parser.builtin.frac2json(item.type, item.kind - FracParser::custom_start,
                                                   parser.in, stream))
                        check(false, "Failed to parse custom type");
                  }
                  else
                  {
                     FracStream tmpin{item.data};
                     if (!parser.builtin.frac2json(item.type, item.kind - FracParser::custom_start,
                                                   tmpin, stream))
                        check(false, "Failed to parse custom type");
                  }
                  break;
            }
         }
      }

      inline const AnyType* Schema::get(const std::string& name) const
      {
         if (auto pos = types.find(name); pos != types.end())
         {
            return &pos->second;
         }
         return nullptr;
      }

      inline void Schema::insert(std::string name, AnyType type)
      {
         types.insert(std::make_pair(std::move(name), std::move(type)));
      }

      template <typename T>
      constexpr bool is_shared_view_ptr_v = false;
      template <typename T>
      constexpr bool is_shared_view_ptr_v<shared_view_ptr<T>> = true;

      template <typename T>
      constexpr bool is_duration_v = false;
      template <typename Rep, typename Period>
      constexpr bool is_duration_v<std::chrono::duration<Rep, Period>> = true;

      template <typename S, typename... T>
      std::vector<Member> insert_variant_alternatives(S& schema, std::variant<T...>*)
      {
         using psio::get_type_name;
         return {
             Member{.name = get_type_name((T*)nullptr), .type = schema.template insert<T>()}...};
      }

      template <typename T, typename S, std::size_t... I>
      std::vector<AnyType> insert_tuple_elements(S& schema, std::index_sequence<I...>)
      {
         return {schema.template insert<std::remove_cvref_t<std::tuple_element_t<I, T>>>()...};
      }

      constexpr std::uint32_t float_exp_bits(int max_exponent)
      {
         std::uint32_t result = 0;
         while (max_exponent > 0)
         {
            max_exponent /= 2;
            ++result;
         }
         return result;
      }

      template <typename T>
      char type_id;

      class SchemaBuilder
      {
        public:
         template <typename T>
         SchemaBuilder& insert(std::string name) &
         {
            schema.insert(std::move(name), insert<T>());
            return *this;
         }
         template <typename T>
         SchemaBuilder&& insert(std::string name) &&
         {
            schema.insert(std::move(name), insert<T>());
            return std::move(*this);
         }
         template <typename T>
         AnyType insert()
         {
            auto [pos, inserted] = ids.insert({&type_id<T>, ids.size()});
            std::string name     = "@" + std::to_string(pos->second);
            if (inserted)
            {
               if constexpr (PackableWrapper<T>)
               {
                  schema.insert(name, insert<std::remove_cvref_t<decltype(clio_unwrap_packable(
                                          std::declval<T&>()))>>());
               }
               else if constexpr (is_shared_view_ptr_v<T>)
               {
                  // TODO: json could unpack nested fracpack
                  schema.insert(name, insert<std::vector<unsigned char>>());
               }
               else if constexpr (std::is_same_v<T, std::vector<char>> ||
                                  std::is_same_v<T, std::vector<signed char>> ||
                                  std::is_same_v<T, std::vector<unsigned char>>)
               {
                  schema.insert(name, Custom{.type = List{insert<typename T::value_type>()},
                                             .id   = "octet-string"});
               }
               else if constexpr (is_std_optional_v<T>)
               {
                  schema.insert(name, Option{insert<typename is_std_optional<T>::value_type>()});
               }
               else if constexpr (std::is_same_v<T, bool>)
               {
                  schema.insert(name, Custom{.type = Int{.bits = 1}, .id = "bool"});
               }
               else if constexpr (std::is_integral_v<T>)
               {
                  schema.insert(name, Int{.bits = 8 * sizeof(T), .isSigned = std::is_signed_v<T>});
               }
               else if constexpr (is_duration_v<T>)
               {
                  schema.insert(name, insert<typename T::rep>());
               }
               else if constexpr (std::numeric_limits<T>::is_iec559)
               {
                  schema.insert(name,
                                Float{.exp = float_exp_bits(std::numeric_limits<T>::max_exponent),
                                      .mantissa = std::numeric_limits<T>::digits});
               }
               else if constexpr (std::is_same_v<T, std::string> ||
                                  std::is_same_v<T, std::string_view> ||
                                  std::is_same_v<T, const char*>)
               {
                  schema.insert(
                      name, Custom{.type = insert<std::vector<unsigned char>>(), .id = "string"});
               }
               else if constexpr (is_std_vector_v<T>)
               {
                  schema.insert(name, List{insert<typename is_std_vector<T>::value_type>()});
               }
               else if constexpr (is_std_variant_v<T>)
               {
                  schema.insert(name, Variant{insert_variant_alternatives(*this, (T*)nullptr)});
               }
               else if constexpr (is_std_array_v<T>)
               {
                  using value_type = std::remove_cv_t<typename is_std_array<T>::value_type>;
                  AnyType arr = Array{.type = insert<value_type>(), .len = is_std_array<T>::size};
                  if constexpr (std::is_same_v<value_type, char> ||
                                std::is_same_v<value_type, signed char> ||
                                std::is_same_v<value_type, unsigned char>)
                  {
                     arr = Custom{.type = std::move(arr), .id = "octet-string"};
                  }
                  schema.insert(name, std::move(arr));
               }
               else if constexpr (std::is_array_v<T>)
               {
                  schema.insert(name,
                                Array{.type = insert<std::remove_cv_t<std::remove_extent_t<T>>>(),
                                      .len  = std::extent_v<T>});
               }
               else if constexpr (reflect<T>::is_struct)
               {
                  std::vector<Member> members;
                  reflect<T>::for_each(
                      [&](const meta& r, auto member)
                      {
                         auto m = member((std::decay_t<T>*)nullptr);
                         if constexpr (not std::is_member_function_pointer_v<decltype(m)>)
                         {
                            using member_type = std::remove_cvref_t<
                                decltype(static_cast<std::decay_t<T>*>(nullptr)->*m)>;
                            members.push_back({.name = r.name, .type = insert<member_type>()});
                         }
                      });
                  if constexpr (reflect<T>::definitionWillNotChange)
                  {
                     schema.insert(name, Struct{std::move(members)});
                  }
                  else
                  {
                     schema.insert(name, Object{std::move(members)});
                  }
               }
               else if constexpr (requires { std::tuple_size<T>::value; })
               {
                  schema.insert(name,
                                Tuple{insert_tuple_elements<T>(
                                    *this, std::make_index_sequence<std::tuple_size_v<T>>())});
               }
               else
               {
                  static_assert(false, "Don't know schema representation");
               }
            }
            return Type{std::move(name)};
         }
         Schema build() &&
         {
            ids.clear();
            return std::move(schema);
         }

        private:
         Schema                             schema;
         std::map<const void*, std::size_t> ids;
      };

      void to_json(const Schema& schema, auto& stream)
      {
         to_json(schema.types, stream);
      }

      void to_json_members(const std::vector<Member>& members, auto& stream)
      {
         CommaList comma;
         stream.write('{');
         for (const auto& member : members)
         {
            comma.next(stream);
            to_json(member.name, stream);
            write_colon(stream);
            to_json(member.type, stream);
         }
         comma.end(stream);
         stream.write('}');
      }

      // - If an auto generated type has an explicit name, use the defined name
      // - If an auto generated type is only used in one place, substitute it inline
      //void Schema::simplify() {}

   }  // namespace schema_types
}  // namespace psio
