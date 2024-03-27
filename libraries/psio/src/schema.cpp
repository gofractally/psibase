#include <psio/schema.hpp>

namespace psio::schema_types
{
   const AnyType* AnyType::resolve(const Schema& schema) const
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

   const AnyType* Schema::get(const std::string& name) const
   {
      if (auto pos = types.find(name); pos != types.end())
      {
         return &pos->second;
      }
      return nullptr;
   }

   void Schema::insert(std::string name, AnyType type)
   {
      types.insert(std::make_pair(std::move(name), std::move(type)));
   }

   void CustomTypes::insert(std::string name, const CustomHandler& t)
   {
      std::size_t index = impl.size();
      impl.push_back(t);
      names.insert({std::move(name), index});
   }
   std::size_t* CustomTypes::find(const std::string& name)
   {
      if (auto pos = names.find(name); pos != names.end())
         return &pos->second;
      return nullptr;
   }
   bool CustomTypes::match(std::size_t index, const CompiledType* type)
   {
      return impl[index].match(type);
   }

   bool matchCustomType(const CompiledType* type, bool*)
   {
      if (auto* itype = std::get_if<Int>(&type->original_type->value))
      {
         return itype->bits == 1 && !itype->isSigned;
      }
      return false;
   }

   template <typename T>
   struct BlobImpl
   {
      static bool match(const CompiledType* type)
      {
         if (type->kind == CompiledType::container)
         {
            const auto& member = type->children[0];
            return !member.is_optional && !member.type->is_variable_size;
         }
         else
         {
            return !type->is_variable_size;
         }
      }
      static bool frac2json(const CompiledType* type, FracStream& in, StreamBase& out)
      {
         if (type->kind == CompiledType::container)
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

   struct StringImpl
   {
      static void frac2json(std::span<const char> in, StreamBase& out)
      {
         to_json(std::string_view{in.data(), in.size()}, out);
      }
   };

   CustomTypes standard_types()
   {
      CustomTypes result;
      result.insert<bool>("bool");
      result.insert("string", BlobImpl<StringImpl>());
      result.insert("octet-string", BlobImpl<OctetStringImpl>());
      return result;
   }

   // ------
   namespace
   {
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
      void link_impl(CompiledSchema* schema, const std::vector<Member>& members, CompiledType* type)
      {
         for (const auto& member : members)
         {
            type->children.push_back(make_member(schema->get(member.type.resolve(schema->schema)),
                                                 type->fixed_size, type->is_variable_size));
         }
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
      std::pair<CompiledType*, VertexEvent> dfs_discover(CompiledSchema*              schema,
                                                         const AnyType*               type,
                                                         CompiledType::Kind           kind,
                                                         std::vector<const AnyType*>& stack)
      {
         if (auto [pos, inserted] = schema->types.insert(std::pair{
                 type,
                 CompiledType{.kind = kind, .is_variable_size = true, .original_type = nullptr}});
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
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Object&                t,
                    std::vector<const AnyType*>& stack)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::object, stack);
         switch (state)
         {
            case start:
               for (const auto& member : t.members)
               {
                  stack.push_back(&member.type);
               }
               break;
            case finish:
               link_impl(schema, t.members, ctype);
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Struct&                t,
                    std::vector<const AnyType*>& stack)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::struct_, stack);
         switch (state)
         {
            case start:
               for (const auto& member : t.members)
               {
                  stack.push_back(&member.type);
               }
               break;
            case finish:
               ctype->is_variable_size = false;
               link_impl(schema, t.members, ctype);
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Tuple&                 t,
                    std::vector<const AnyType*>& stack)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::object, stack);
         switch (state)
         {
            case start:
               for (const auto& member : t.members)
               {
                  stack.push_back(&member);
               }
               break;
            case finish:
               for (const auto& member : t.members)
               {
                  ctype->children.push_back(make_member(schema->get(member.resolve(schema->schema)),
                                                        ctype->fixed_size,
                                                        ctype->is_variable_size));
               }
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Int&                   t,
                    std::vector<const AnyType*>& stack)
      {
         schema->types.insert({type,
                               {.kind             = CompiledType::scalar,
                                .is_variable_size = false,
                                .fixed_size       = (t.bits + 7) / 8,
                                .original_type    = type}});
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Float&                 t,
                    std::vector<const AnyType*>& stack)
      {
         schema->types.insert({type,
                               {.kind             = CompiledType::scalar,
                                .is_variable_size = false,
                                .fixed_size       = (t.exp + t.mantissa + 7) / 8,
                                .original_type    = type}});
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Array&                 t,
                    std::vector<const AnyType*>& stack)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::array, stack);
         switch (state)
         {
            case start:
               stack.push_back(t.type.get());
               break;
            case finish:
            {
               ctype->is_variable_size    = false;
               const CompiledType* nested = schema->get(t.type->resolve(schema->schema));
               ctype->children.push_back(
                   make_member(nested, ctype->fixed_size, ctype->is_variable_size));
               // TODO: handle array of zero-size elements
               ctype->fixed_size *= t.len;
            }
            break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Option&                t,
                    std::vector<const AnyType*>& stack)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::optional, stack);
         switch (state)
         {
            case start:
               stack.push_back(t.type.get());
               break;
            case finish:
               ctype->children.push_back({.type = schema->get(t.type->resolve(schema->schema))});
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const List&                  t,
                    std::vector<const AnyType*>& stack)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::container, stack);
         switch (state)
         {
            case start:
               stack.push_back(t.type.get());
               break;
            case finish:
               ctype->children.push_back({.type = schema->get(t.type->resolve(schema->schema))});
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Variant&               t,
                    std::vector<const AnyType*>& stack)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::variant, stack);
         switch (state)
         {
            case start:
               for (const auto& member : t.members)
               {
                  stack.push_back(&member.type);
               }
               break;
            case finish:
               for (const auto& member : t.members)
               {
                  ctype->children.push_back(
                      {.type = schema->get(member.type.resolve(schema->schema))});
               }
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Custom&                t,
                    std::vector<const AnyType*>& stack)
      {
         auto kind           = static_cast<CompiledType::Kind>(CompiledType::scalar);
         auto [ctype, state] = dfs_discover(schema, type, kind, stack);
         switch (state)
         {
            case start:
               stack.push_back(t.type.get());
               break;
            case finish:
            {
               CompiledType* child = schema->get(t.type->resolve(schema->schema));
               // TODO: This is sufficient to prevent crashes, but not to detect all errors
               if (!child->original_type)
                  check(false, "A Custom type may not depend on itself");
               ctype->kind             = child->kind;
               ctype->is_variable_size = child->is_variable_size;
               ctype->fixed_size       = child->fixed_size;
               ctype->children         = child->children;
               ctype->original_type    = child->original_type;
               if (auto index = schema->builtin.find(t.id))
               {
                  if (schema->builtin.match(*index, ctype))
                     ctype->custom_id = *index;
               }
            }
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Type&                  t,
                    std::vector<const AnyType*>& stack)
      {
         if (const AnyType* next = schema->schema.get(t.type))
         {
            stack.push_back(next);
         }
         else
         {
            check(false, "undefined type: " + t.type);
         }
      }
   }  // namespace

   CompiledSchema::CompiledSchema(const Schema& schema, CustomTypes builtin)
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
         std::visit([&](const auto& t) { add_impl(this, top, t, stack); }, top->value);
      }
   }

   CompiledType* CompiledSchema::get(const AnyType* type)
   {
      if (auto pos = types.find(type); pos != types.end())
         return &pos->second;
      return nullptr;
   }
   const CompiledType* CompiledSchema::get(const AnyType* type) const
   {
      if (auto pos = types.find(type); pos != types.end())
         return &pos->second;
      return nullptr;
   }
   //-----

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
            (void)unpack_numeric<false>(&fixed_size, parser.in.src, fixed_pos, parser.in.end_pos);
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
            parser.check_heap_pos(parser.in.end_pos);
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
         result.index  = tag;
         return result;
      }
   };

   FracParser::FracParser(std::span<const char> data,
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

   FracParser::~FracParser() = default;

   void FracParser::deref(std::uint32_t       fixed_pos,
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

   FracParser::Item FracParser::parse(const CompiledType* ctype)
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

   void FracParser::parse_fixed(Item& result, const CompiledType* ctype, std::uint32_t fixed_pos)
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

   FracParser::Item FracParser::next()
   {
      if (stack.empty())
         return {};
      std::size_t original_size = stack.size();
      auto        result        = std::visit(
          [&](auto& item)
          {
             // ensure that the reader can safely push items onto the stack
             auto copy                = std::move(item);
             auto res                 = copy.next(*this);
             stack[original_size - 1] = std::move(copy);
             return res;
          },
          stack.back());
      if (result.kind == end || std::holds_alternative<Item>(stack.back()))
      {
         stack.pop_back();
      }
      return result;
   }

   void FracParser::push(const CompiledType* type, std::uint32_t offset)
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
   void FracParser::push_fixed(const CompiledType* type, std::uint32_t offset)
   {
      switch (type->kind)
      {
         case CompiledType::struct_:
         {
            stack.push_back(ObjectReader{.start_pos = offset, .index = 0, .type = type});
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

   std::span<const char> FracParser::read(const CompiledType* type, std::uint32_t offset)
   {
      in.pos = offset + type->fixed_size;
      check(in.pos <= in.end_pos && in.pos >= offset, "out-of-bounds read");
      return {in.src + offset, type->fixed_size};
   }
   std::span<const char> FracParser::read_fixed(const CompiledType* type, std::uint32_t offset)
   {
      // TODO: verify bounds against end of fixed data
      return {in.src + offset, type->fixed_size};
   }

   void FracParser::check_heap_pos(std::uint32_t offset)
   {
      if (in.known_end)
         check(in.pos == offset, "wrong offset");
      else
         check(in.pos <= offset, "offset moved backwards");
   }

   namespace
   {
      void addRef(auto& refs, AnyType& type);
      void addRef(auto& refs, AnyType&, List& type)
      {
         addRef(refs, *type.type);
      }
      void addRef(auto& refs, AnyType&, Array& type)
      {
         addRef(refs, *type.type);
      }
      void addRef(auto& refs, AnyType&, Option& type)
      {
         addRef(refs, *type.type);
      }
      void addRef(auto& refs, AnyType&, Custom& type)
      {
         addRef(refs, *type.type);
      }
      void addRef(auto& refs, std::vector<Member>& types)
      {
         for (auto& member : types)
         {
            addRef(refs, member.type);
         }
      }
      void addRef(auto& refs, AnyType&, Object& type)
      {
         addRef(refs, type.members);
      }
      void addRef(auto& refs, AnyType&, Struct& type)
      {
         addRef(refs, type.members);
      }
      void addRef(auto& refs, AnyType&, Tuple& type)
      {
         for (auto& member : type.members)
         {
            addRef(refs, member);
         }
      }
      void addRef(auto& refs, AnyType&, Variant& type)
      {
         addRef(refs, type.members);
      }
      void addRef(auto& refs, AnyType&, Int&) {}
      void addRef(auto& refs, AnyType&, Float&) {}
      void addRef(auto& refs, AnyType& type, Type& t)
      {
         refs[t.type].push_back(&type);
      }
      void addRef(auto& refs, AnyType& type)
      {
         std::visit([&](auto& t) { addRef(refs, type, t); }, type.value);
      }
      const std::string& resolveAlias(auto& resolved, const std::string& name)
      {
         const std::string* result = &name;
         while (true)
         {
            if (auto pos = resolved.find(*result); pos != resolved.end())
            {
               result = &pos->second;
            }
            else
            {
               return *result;
            }
         }
      }
      void setChain(auto& resolved, const std::string& name, const std::string& newValue)
      {
         if (name == newValue)
            return;
         std::string current = name;
         while (true)
         {
            if (auto pos = resolved.find(current); pos != resolved.end())
            {
               if (pos->second == newValue)
                  return;
               current     = std::move(pos->second);
               pos->second = newValue;
            }
            else
            {
               resolved.insert({name, newValue});
               return;
            }
         }
      }
      std::weak_ordering compareAlias(std::string_view lhs, std::string_view rhs)
      {
         bool lhsCanReplace = lhs.starts_with('@');
         bool rhsCanReplace = rhs.starts_with('@');
         if (!lhsCanReplace && !rhsCanReplace)
            return std::weak_ordering::equivalent;
         return std::tuple(!lhsCanReplace, lhs.size(), lhs) <=>
                std::tuple(!rhsCanReplace, rhs.size(), rhs);
      }
      void addAlias(auto& resolved, const std::string& name, const std::string& alias)
      {
         const std::string& lhs = resolveAlias(resolved, name);
         const std::string& rhs = resolveAlias(resolved, name);
         if (auto cmp = compareAlias(lhs, rhs); cmp != 0)
         {
            const std::string& best = cmp < 0 ? lhs : rhs;
            setChain(resolved, name, best);
            setChain(resolved, alias, best);
         }
         else
         {
            setChain(resolved, name, lhs);
            setChain(resolved, alias, rhs);
         }
      }
   }  // namespace

   void SchemaBuilder::optimize()
   {
      std::map<std::string, std::vector<AnyType*>> refs;
      // Group all aliases, user defined types are not replaced
      // lower numbered aliases are preferred.
      std::map<std::string, std::string> resolved;
      for (auto& [name, type] : schema.types)
      {
         if (auto* alias = std::get_if<Type>(&type.value))
         {
            addAlias(resolved, name, alias->type);
         }
         else
         {
            addRef(refs, type);
         }
         refs.try_emplace(name);
      }
      // Unify references to the same type
      for (auto& [name, locations] : refs)
      {
         const auto& alias = resolveAlias(resolved, name);
         setChain(resolved, name, alias);
         if (name != alias)
         {
            auto& alias_locations = refs[alias];
            alias_locations.insert(alias_locations.end(), locations.begin(), locations.end());
            locations.clear();
            // ensure that the resolved location holds the actual type
            auto pos = schema.types.find(name);
            if (!std::holds_alternative<Type>(pos->second.value))
            {
               schema.types.find(alias)->second = std::move(pos->second);
            }
            schema.types.erase(pos);
         }
      }
      // Write the resolved types into schema
      for (const auto& [name, locations] : refs)
      {
         if (name.starts_with('@') && locations.size() == 1)
         {
            auto pos           = schema.types.find(name);
            *locations.front() = std::move(pos->second);
            schema.types.erase(pos);
         }
         else
         {
            for (AnyType* loc : locations)
            {
               *loc = Type{name};
            }
         }
      }
   }

}  // namespace psio::schema_types
