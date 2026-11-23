#include <services/user/REvents.hpp>

#include <alloca.h>
#include <sqlite3.h>
#include <psibase/HttpHeaders.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <regex>
#include <services/local/XAdmin.hpp>
#include <services/system/HttpServer.hpp>
#include <services/user/EventIndex.hpp>
#include <services/user/Events.hpp>
#include <services/user/EventsTables.hpp>

#include "SchemaCache.hpp"
#include "eventKeys.hpp"
#include "types.hpp"

using namespace psibase;
namespace ir = psio::pssz_ir;
using psio::schema_types::Float;
using psio::schema_types::Int;
using namespace UserService;

int compare_account_number(void*, int lsize, const void* ldata, int rsize, const void* rdata)
{
   auto lhs = AccountNumber{std::string_view{(const char*)ldata, static_cast<std::size_t>(lsize)}};
   auto rhs = AccountNumber{std::string_view{(const char*)rdata, static_cast<std::size_t>(rsize)}};
   if (lhs < rhs)
      return -1;
   else if (rhs < lhs)
      return 1;
   else
      return 0;
}

// The collation of a column, if it is not the default
const char* custom_collation(const EventColumn& column)
{
   return column.kind == ColumnKind::account ? "ACCOUNT" : nullptr;
}

void register_collation(void*, sqlite3* db, int eTextRep, const char* name)
{
   if (name == std::string_view{"ACCOUNT"})
   {
      sqlite3_create_collation(db, name, SQLITE_UTF8, nullptr, compare_account_number);
   }
}

void getColumns(const EventSchema& type, auto& stream)
{
   bool first = true;
   for (const auto& column : type.columns)
   {
      if (first)
         first = false;
      else
         stream.write(',');
      stream.write(column.name.data(), column.name.size());
      if (const char* collate = custom_collation(column))
      {
         stream.write(" TEXT COLLATE ", 14);
         stream.write(collate, std::strlen(collate));
      }
   }
}

struct EventVTab : sqlite3_vtab
{
   EventVTab(EventDb db, AccountNumber service, MethodNumber event, const EventSchema* type)
       : index{db, service, event}, rowType(type)
   {
      auto secondary = SecondaryIndexTable(
          DbId::writeOnly,
          psio::encode(psio::key{}, std::tuple(EventIndex::service, secondaryIndexReadyTableNum)));
      if (auto row = secondary.getIndex<0>().get(std::tuple(db, service, event)))
         indexes = std::move(row->indexes);
      else
         indexes = std::vector{SecondaryIndexInfo{}};
   }
   EventIndexTable                 index;
   std::vector<SecondaryIndexInfo> indexes;
   const EventSchema*              rowType;
   std::vector<char>               key() const { return psio::encode(psio::key{}, index); }
   std::string_view                get_collation(int column) const
   {
      if (const char* collate = custom_collation(rowType->columns[column]))
      {
         return collate;
      }
      return "BINARY";
   }
};

struct EventCursor : sqlite3_vtab_cursor
{
   std::vector<char> key;
   std::vector<char> end;
   std::vector<char> data;
   // The arguments of the current event, decoded when a column is first read
   std::optional<ir::Value> value;
   bool                     invalid = false;
   std::size_t              prefixLen;
   bool              descending = false;
   EventIndexHandle  handle{KvMode::read};
   EventTable        events;
   EventCursor(const EventVTab& vtab)
       : key(vtab.key()),
         prefixLen(key.size() + 1),
         events(EventConfig{}.openEvents(vtab.index.db, KvMode::read))
   {
   }
   EventVTab* vtab() { return static_cast<EventVTab*>(pVtab); }
   int        setEof()
   {
      key.resize(prefixLen - 1);
      return SQLITE_OK;
   }
   bool          eof() { return key.size() < prefixLen; }
   std::uint64_t eventId() const { return keyToEventId(key, prefixLen); }
   void          load(std::uint32_t sz)
   {
      if (sz == 0xffffffffu)
         setEof();
      else
      {
         auto key_size = psibase::raw::getKey(nullptr, 0);
         key.resize(key_size);
         psibase::raw::getKey(key.data(), key.size());
         bool outOfRange = descending ? compare_blob(key, end) < 0
                                      : (!end.empty() && compare_blob(key, end) >= 0);
         if (outOfRange)
            setEof();
         else
         {
            auto row = events.getView(eventId());
            if (!row)
            {
               check(false, "Internal error: indexed event does not exist");
            }
            // Extract just the data
            if ((*row)->service() != vtab()->index.service)
            {
               check(false, "Internal error: event service does not match index");
            }
            data = (*row)->rawData().unpack();
            value.reset();
            invalid = false;
         }
      }
   }
   void seek() { load(psibase::raw::kvGreaterEqual(handle, key.data(), key.size(), prefixLen)); }
   void seekPrev() { load(psibase::raw::kvLessThan(handle, key.data(), key.size(), prefixLen)); }
   void seekLast() { load(psibase::raw::kvMax(handle, key.data(), prefixLen)); }
};

int event_eof(sqlite3_vtab_cursor* cursor)
{
   auto* c = static_cast<EventCursor*>(cursor);
   return c->eof() ? 1 : 0;
}

int event_next(sqlite3_vtab_cursor* cursor)
{
   auto* c = static_cast<EventCursor*>(cursor);
   if (c->eof())
   {
      return SQLITE_ERROR;
   }
   if (c->descending)
   {
      c->seekPrev();
   }
   else
   {
      c->key.push_back('\0');
      c->seek();
   }
   return SQLITE_OK;
}

int event_rowid(sqlite3_vtab_cursor* cursor, sqlite_int64* result)
{
   auto* c = static_cast<EventCursor*>(cursor);
   if (c->eof())
      return SQLITE_ERROR;
   *result = c->eventId();
   return SQLITE_OK;
}

int number_to_sql(const ir::Value& value, sqlite3_context* ctx)
{
   if (auto* v = std::get_if<ir::Signed>(&value.value))
   {
      sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(v->value));
   }
   else if (auto* v = std::get_if<ir::Unsigned>(&value.value))
   {
      auto result = static_cast<std::uint64_t>(v->value);
      if (result & (1ull << 63))
         sqlite3_result_double(ctx, result);
      else
         sqlite3_result_int64(ctx, static_cast<sqlite_int64>(result));
   }
   else if (auto* v = std::get_if<float>(&value.value))
   {
      sqlite3_result_double(ctx, *v);
   }
   else if (auto* v = std::get_if<double>(&value.value))
   {
      sqlite3_result_double(ctx, *v);
   }
   else
   {
      sqlite3_result_text(ctx, "Internal error: unhandled scalar type", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   return SQLITE_OK;
}

std::string_view jsonPrefix("\x2f\x0a\xc4\x5b\xc1\xe1\x4d\xcc\x60\x02\xd4\xbe\x67\xb9\x06\xd4", 16);

int event_column(sqlite3_vtab_cursor* cursor, sqlite3_context* ctx, int n)
{
   auto*       c    = static_cast<EventCursor*>(cursor);
   const auto& type = *c->vtab()->rowType;
   if (!c->value && !c->invalid)
   {
      c->value.emplace();
      if (!decodeEvent(type, c->data, *c->value))
      {
         c->value.reset();
         c->invalid = true;
      }
   }
   if (c->invalid || n < 0 || static_cast<std::size_t>(n) >= type.columns.size())
   {
      sqlite3_result_text(ctx, "The event does not match its schema", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   const auto&      column = type.columns[n];
   const ir::Value* value  = &eventMember(*c->value, n);
   if (column.optional)
   {
      auto* optional = std::get_if<ir::Optional>(&value->value);
      if (!optional || !optional->some)
      {
         sqlite3_result_null(ctx);
         return SQLITE_OK;
      }
      value = optional->some.get();
   }
   switch (column.kind)
   {
      case ColumnKind::integer:
      case ColumnKind::real:
         return number_to_sql(*value, ctx);
      case ColumnKind::boolean:
         if (auto* v = std::get_if<bool>(&value->value))
         {
            sqlite3_result_int(ctx, *v ? 1 : 0);
            return SQLITE_OK;
         }
         break;
      case ColumnKind::text:
         if (auto* v = std::get_if<std::string>(&value->value))
         {
            sqlite3_result_text64(ctx, v->data(), v->size(), SQLITE_TRANSIENT, SQLITE_UTF8);
            return SQLITE_OK;
         }
         break;
      case ColumnKind::blob:
         if (auto* v = std::get_if<ir::Bytes>(&value->value))
         {
            sqlite3_result_blob64(ctx, v->data(), v->size(), SQLITE_TRANSIENT);
            return SQLITE_OK;
         }
         break;
      case ColumnKind::account:
         // The wire type of an AccountNumber is a record of one u64
         if (auto* v = std::get_if<ir::Record>(&value->value); v && v->size() == 1)
            if (auto* number = std::get_if<ir::Unsigned>(&(*v)[0].second.value))
            {
               auto s = AccountNumber{static_cast<std::uint64_t>(number->value)}.str();
               sqlite3_result_text64(ctx, s.data(), s.size(), SQLITE_TRANSIENT, SQLITE_UTF8);
               return SQLITE_OK;
            }
         break;
      case ColumnKind::json:
         break;
   }
   // json as text
   std::string result(jsonPrefix);
   if (auto status = ir::value_to_json(*type.types, *column.value, psio::ijson{}, *value, result,
                                       &psibase_builtins());
       !status.ok())
   {
      sqlite3_result_text(ctx, "The column has no JSON text", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   sqlite3_result_text64(ctx, result.data(), result.size(), SQLITE_TRANSIENT, SQLITE_UTF8);
   return SQLITE_OK;
}

int event_connect(sqlite3*           db,
                  void*              pAux,
                  int                args,
                  const char* const* argv,
                  sqlite3_vtab**     ppVtab,
                  char**             err)
{
   AccountNumber service  = {};
   MethodNumber  event    = {};
   EventDb       event_db = EventDb::historyEvent;
   for (int i = 3; i < args; ++i)
   {
      std::string_view arg = argv[i];
      if (arg.starts_with("service="))
      {
         service = AccountNumber{arg.substr(8)};
      }
      else if (arg.starts_with("db="))
      {
         if (arg == "db=history")
         {
            event_db = EventDb::historyEvent;
         }
         else if (arg == "db=merkle")
         {
            event_db = EventDb::merkleEvent;
         }
         else
         {
            check(false, "Unknown db: " + std::string(arg.substr(3)));
         }
      }
      else if (arg.starts_with("type="))
      {
         event = MethodNumber{arg.substr(5)};
      }
      else
      {
         check(false, "Unknown argument: " + std::string(arg));
      }
   }
   auto* user = (const AccountNumber*)sqlite3_get_clientdata(db, "user");
   check(user != nullptr, "username not set");
   const EventSchema* type =
       SchemaCache::instance().getSchemaType(*user, event_db, service, event);
   if (type == nullptr)
      return SQLITE_ERROR;
   auto                vtab = std::make_unique<EventVTab>(event_db, service, event, type);
   std::vector<char>   index;
   psio::vector_stream stream{index};
   stream.write("CREATE TABLE e(", 15);
   getColumns(*vtab->rowType, stream);
   stream.write(")", 2);
   if (int err = sqlite3_declare_vtab(db, index.data()))
      return err;
   *ppVtab = vtab.release();
   return SQLITE_OK;
}

int event_disconnect(sqlite3_vtab* vtab)
{
   delete static_cast<EventVTab*>(vtab);
   return SQLITE_OK;
}

struct IndexConstraints
{
   bool usable : 1;
   bool unique : 1;
   bool eq : 1;
   bool upper : 1;
   bool lower : 1;
   int  limit = -1;
   int  estimatedCost() const
   {
      if (!usable)
         return 1000000;
      int cost;
      if (eq && unique)
         cost = 1;
      else if (eq && !unique)
         cost = 10;
      else if (lower && upper)
         cost = 300;
      else if (lower || upper)
         cost = 500;
      else
         cost = 1000;
      if (limit >= 0 && limit < cost)
         cost = limit;
      return cost;
   }
   friend bool operator==(const IndexConstraints&, const IndexConstraints&) = default;
};
auto operator<=>(const IndexConstraints& lhs, const IndexConstraints& rhs)
{
   return lhs.estimatedCost() <=> rhs.estimatedCost();
}

// A single-column ORDER BY can be satisfied by scanning that column's index.
// If the query also has a LIMIT, the scan stops after that many rows, so lower
// that column's cost accordingly.
void applyOrderByLimitCost(sqlite3_index_info* info, IndexConstraints& orderByCol)
{
   auto constraintRange =
       std::ranges::subrange(info->aConstraint, info->aConstraint + info->nConstraint);
   auto limitConstraint = std::ranges::find_if(
       constraintRange, [](auto& c) { return c.op == SQLITE_INDEX_CONSTRAINT_LIMIT; });
   if (limitConstraint == constraintRange.end())
      return;

   const int      i     = static_cast<int>(limitConstraint - info->aConstraint);
   sqlite3_value* value = nullptr;
   if (sqlite3_vtab_rhs_value(info, i, &value) == SQLITE_OK)
      orderByCol.limit = sqlite3_value_int64(value);
}

int event_best_index(sqlite3_vtab* base_vtab, sqlite3_index_info* info)
{
   auto                          vtab = static_cast<EventVTab*>(base_vtab);
   std::vector<IndexConstraints> constraints(vtab->rowType->columns.size() + 1);
   constraints[0] = {.usable = true, .unique = true};
   for (const auto& index : vtab->indexes)
   {
      constraints[index.getPos()].usable = true;
   }
   auto usableConstraint = [&](int idx)
   {
      if (!info->aConstraint[idx].usable)
         return false;
      auto column = info->aConstraint[idx].iColumn;
      if (column < 0)
         return true;
      return sqlite3_vtab_collation(info, idx) == vtab->get_collation(column);
   };
   for (int i = 0; i < info->nConstraint; ++i)
   {
      if (usableConstraint(i) && constraints[info->aConstraint[i].iColumn + 1].usable)
      {
         switch (info->aConstraint[i].op)
         {
            case SQLITE_INDEX_CONSTRAINT_EQ:
               constraints[info->aConstraint[i].iColumn + 1].eq = true;
               break;
            case SQLITE_INDEX_CONSTRAINT_LT:
            case SQLITE_INDEX_CONSTRAINT_LE:
               constraints[info->aConstraint[i].iColumn + 1].lower = true;
               break;
            case SQLITE_INDEX_CONSTRAINT_GT:
            case SQLITE_INDEX_CONSTRAINT_GE:
               constraints[info->aConstraint[i].iColumn + 1].upper = true;
               break;
         }
      }
   }

   if (info->nOrderBy == 1 && constraints[info->aOrderBy[0].iColumn + 1].usable)
      applyOrderByLimitCost(info, constraints[info->aOrderBy[0].iColumn + 1]);

   int  best = std::ranges::min_element(constraints) - constraints.begin() - 1;
   bool desc = false;
   if (info->nOrderBy == 1 && best == info->aOrderBy[0].iColumn)
   {
      info->orderByConsumed = 1;
      desc                  = info->aOrderBy[0].desc;
   }
   auto buf  = static_cast<char*>(alloca(info->nConstraint + 2));
   int  argc = 0;
   buf[0]    = desc ? '-' : '+';
   for (int i = 0; i < info->nConstraint; ++i)
   {
      auto appendArg = [&](char type)
      {
         buf[argc + 1]                       = type;
         info->aConstraintUsage[i].argvIndex = argc + 1;
         ++argc;
      };
      if (info->aConstraint[i].iColumn == best && usableConstraint(i))
      {
         switch (info->aConstraint[i].op)
         {
            case SQLITE_INDEX_CONSTRAINT_EQ:
               appendArg('=');
               break;
            case SQLITE_INDEX_CONSTRAINT_LT:
               appendArg(')');
               break;
            case SQLITE_INDEX_CONSTRAINT_LE:
               appendArg(']');
               break;
            case SQLITE_INDEX_CONSTRAINT_GT:
               appendArg('(');
               break;
            case SQLITE_INDEX_CONSTRAINT_GE:
               appendArg('[');
               break;
         }
      }
   }
   buf[argc + 1] = '\0';
   info->idxNum  = best;
   info->idxStr  = (char*)sqlite3_malloc(argc + 2);
   if (!info->idxStr)
      return SQLITE_NOMEM;
   std::memcpy(info->idxStr, buf, argc + 2);
   info->needToFreeIdxStr = 1;
   info->estimatedCost    = constraints[best + 1].estimatedCost();
   return SQLITE_OK;
}

int event_open(sqlite3_vtab* vtab, sqlite3_vtab_cursor** result)
{
   *result = new EventCursor{*static_cast<EventVTab*>(vtab)};
   return SQLITE_OK;
}

int event_close(sqlite3_vtab_cursor* cursor)
{
   delete static_cast<EventCursor*>(cursor);
   return SQLITE_OK;
}

enum class KeyResult
{
   underflow,
   overflow,
   exact,
   rounded,
};

KeyResult int64_to_key(const Int& type, sqlite_int64 value, std::vector<char>& out)
{
   auto bytes = (type.bits + 7) / 8;
   if (type.isSigned)
   {
      std::uint64_t limit = 1ull << (type.bits - 1);
      if (value < static_cast<sqlite3_int64>(-limit))
         return KeyResult::underflow;
      if (value > static_cast<sqlite3_int64>(limit - 1))
         return KeyResult::overflow;
      value ^= (1ull << (bytes * 8 - 1));
   }
   else
   {
      if (value < 0)
         return KeyResult::underflow;
      if (static_cast<std::uint64_t>(value) > (2ull << (type.bits - 1)) - 1)
         return KeyResult::overflow;
   }
   for (int i = 0; i < bytes; ++i)
   {
      out.push_back((value >> 8 * (bytes - i - 1)) & 0xFF);
   }
   return KeyResult::exact;
}

KeyResult sql_to_key(const Int& type, sqlite3_value* key, std::vector<char>& out)
{
   switch (sqlite3_value_numeric_type(key))
   {
      case SQLITE_INTEGER:
         return int64_to_key(type, sqlite3_value_int64(key), out);
      case SQLITE_FLOAT:
      {
         double value = sqlite3_value_double(key);
         if (value >= -static_cast<double>(std::numeric_limits<sqlite3_int64>::min()))
            return KeyResult::overflow;
         if (value < static_cast<double>(std::numeric_limits<sqlite3_int64>::min()))
            return KeyResult::underflow;
         // round-to-zero
         sqlite_int64 ivalue = static_cast<sqlite_int64>(value);
         // Adjust to round-to-positive-inf
         if (static_cast<double>(ivalue) < value)
         {
            ++ivalue;
         }
         auto result = int64_to_key(type, ivalue, out);
         if (result == KeyResult::exact && static_cast<double>(ivalue) != value)
            return KeyResult::rounded;
         return result;
      }
      case SQLITE_TEXT:
      case SQLITE_BLOB:
         return KeyResult::overflow;
      case SQLITE_NULL:
         return KeyResult::underflow;
      default:
         abortMessage("Unknown sqlite3_value");
   }
}

KeyResult double_to_key(const Float& type, double value, std::vector<char>& out)
{
   if (type == Float{.exp = 11, .mantissa = 53})
   {
      psio::to_key(value, out);
      return KeyResult::exact;
   }
   else if (type == Float{.exp = 8, .mantissa = 24})
   {
      auto fvalue = static_cast<float>(value);
      auto result = KeyResult::exact;
      psio::to_key(fvalue, out);
      if (fvalue != value)
      {
         result = KeyResult::rounded;
         if (fvalue < value)
            ++out.back();
      }
      return result;
   }
   abortMessage("Only single and double precision floating-point are supported");
}

KeyResult sql_to_key(const Float& type, sqlite3_value* key, std::vector<char>& out)
{
   switch (sqlite3_value_numeric_type(key))
   {
      case SQLITE_INTEGER:
      {
         auto value  = sqlite3_value_int64(key);
         auto dvalue = static_cast<double>(value);
         if (static_cast<sqlite_int64>(dvalue) < value)
         {
            dvalue = std::nextafter(dvalue, std::numeric_limits<double>::infinity());
         }
         auto result = double_to_key(type, sqlite3_value_int64(key), out);
         if (static_cast<sqlite_int64>(dvalue) < value)
            return KeyResult::rounded;
         return result;
      }
      case SQLITE_FLOAT:
         return double_to_key(type, sqlite3_value_double(key), out);
      case SQLITE_TEXT:
      case SQLITE_BLOB:
         return KeyResult::overflow;
      case SQLITE_NULL:
         return KeyResult::underflow;
      default:
         abortMessage("Unknown sqlite3_value");
   }
}

KeyResult string_to_key(sqlite3_value* key, std::vector<char>& out)
{
   psio::to_key(std::string{reinterpret_cast<const char*>(sqlite3_value_text(key)),
                            static_cast<std::size_t>(sqlite3_value_bytes(key))},
                out);
   return KeyResult::exact;
}

KeyResult account_to_key(sqlite3_value* key, std::vector<char>& out)
{
   auto s = std::string_view{reinterpret_cast<const char*>(sqlite3_value_text(key)),
                             static_cast<std::size_t>(sqlite3_value_bytes(key))};
   psio::to_key(AccountNumber{s}, out);
   return KeyResult::exact;
}

KeyResult blob_to_key(sqlite3_value* key, std::vector<char>& out)
{
   auto data = static_cast<const unsigned char*>(sqlite3_value_blob(key));
   psio::to_key(std::vector<unsigned char>{data, data + sqlite3_value_bytes(key)}, out);
   return KeyResult::exact;
}

// The key (psio::key) of an SQL value as the value of a column
KeyResult value_to_key(const EventColumn& column, sqlite3_value* key, std::vector<char>& out)
{
   switch (column.kind)
   {
      case ColumnKind::integer:
         return sql_to_key(std::get<Int>(column.scalar->value), key, out);
      case ColumnKind::real:
         return sql_to_key(std::get<Float>(column.scalar->value), key, out);
      case ColumnKind::text:
         return string_to_key(key, out);
      case ColumnKind::blob:
         return blob_to_key(key, out);
      case ColumnKind::account:
         return account_to_key(key, out);
      case ColumnKind::boolean:
      case ColumnKind::json:
         break;
   }
   abortMessage("Not implemented: a key of the column " + column.name);
}

KeyResult sql_to_key(const EventColumn& column, sqlite3_value* key, std::vector<char>& out)
{
   if (column.optional)
   {
      // psio::key of an optional: 00, or 01 and the key of the value
      if (sqlite3_value_type(key) == SQLITE_NULL)
      {
         out.push_back(0);
         return KeyResult::exact;
      }
      else
      {
         out.push_back(1);
         auto result = value_to_key(column, key, out);
         if (result == KeyResult::underflow)
            return KeyResult::rounded;
         return result;
      }
   }
   else
   {
      return value_to_key(column, key, out);
   }
}

int event_filter(sqlite3_vtab_cursor* cursor,
                 int                  index,
                 const char*          argTypes,
                 int                  argc,
                 sqlite3_value**      argv)
{
   auto*             c    = static_cast<EventCursor*>(cursor);
   auto*             vtab = static_cast<EventVTab*>(cursor->pVtab);
   std::vector<char> key  = vtab->key();
   key.push_back(static_cast<char>(index));
   c->prefixLen = key.size();
   c->key       = key;
   // xFilter may be called multiple times to restart a scan on the same
   // cursor; the upper bound must not leak from a previous filter.
   c->end.clear();
   const EventColumn& keyType =
       index >= 0 ? vtab->rowType->columns[index] : eventNumberColumn();
   auto incKey  = [&](std::vector<char>& k)
   {
      std::size_t i = k.size();
      while (i > c->prefixLen)
      {
         if (++k[--i] != 0)
         {
            return true;
         }
      }
      return false;
   };
   auto incExactKey = [&](std::vector<char>& k, KeyResult& adj)
   {
      if (adj == KeyResult::exact)
         if (!incKey(key))
            adj = KeyResult::overflow;
   };
   for (int i = 0; i < argc; ++i)
   {
      key.resize(c->prefixLen);
      auto adj = sql_to_key(keyType, argv[i], key);
      switch (argTypes[i + 1])
      {
         case '=':
            if (adj != KeyResult::exact)
               return c->setEof();
            c->key = key;
            c->end = c->key;
            if (!incKey(c->end))
               c->end.clear();
            break;
         case '(':
            incExactKey(key, adj);
            [[fallthrough]];
         case '[':
            if (adj == KeyResult::overflow)
               return c->setEof();
            if (compare_blob(key, c->key) > 0)
               c->key = key;
            break;
         case ']':
            incExactKey(key, adj);
            [[fallthrough]];
         case ')':
            if (adj == KeyResult::underflow)
               return c->setEof();
            if (adj != KeyResult::overflow && (c->end.empty() || compare_blob(key, c->end) < 0))
               c->end = key;
            break;
      }
   }
   c->descending = (argTypes[0] == '-');
   if (c->descending)
   {
      std::vector<char> upper = std::move(c->end);
      c->end                  = std::move(c->key);
      if (upper.empty())
      {
         c->key.assign(c->end.begin(), c->end.begin() + c->prefixLen);
         c->seekLast();
      }
      else
      {
         c->key = std::move(upper);
         c->seekPrev();
      }
   }
   else
   {
      c->seek();
   }
   return SQLITE_OK;
}

sqlite3_module eventModule = {
    .iVersion    = 4,
    .xCreate     = event_connect,
    .xConnect    = event_connect,
    .xBestIndex  = event_best_index,
    .xDisconnect = event_disconnect,
    .xDestroy    = event_disconnect,
    .xOpen       = event_open,
    .xClose      = event_close,
    .xFilter     = event_filter,
    .xNext       = event_next,
    .xEof        = event_eof,
    .xColumn     = event_column,
    .xRowid      = event_rowid,
};

// Appends `"<column name>":<value>` of column i of the current row.
// INTEGER and REAL are numbers (a 64-bit integer beyond 2^53 - 1 is a
// decimal string, as everywhere in I-JSON), TEXT a string (a JSON column
// is its value), BLOB upper-case hex. A value with no JSON text (a
// non-finite REAL, TEXT that is not UTF-8) is null.
void column_to_json(sqlite3_stmt* stmt, int i, std::vector<char>& out)
{
   auto write = [&](std::string_view text) { out.insert(out.end(), text.begin(), text.end()); };
   auto value = [&](const auto& v)
   {
      if (!psio::encode_json_checked(psio::ijson{}, v, out).ok())
         write("null");
   };
   value(std::string_view{sqlite3_column_name(stmt, i)});
   write(":");
   switch (sqlite3_column_type(stmt, i))
   {
      case SQLITE_INTEGER:
         value(static_cast<std::int64_t>(sqlite3_column_int64(stmt, i)));
         break;
      case SQLITE_FLOAT:
         value(sqlite3_column_double(stmt, i));
         break;
      case SQLITE_TEXT:
      {
         auto result = std::string_view{reinterpret_cast<const char*>(sqlite3_column_text(stmt, i)),
                                        static_cast<std::size_t>(sqlite3_column_bytes(stmt, i))};
         if (result.starts_with(jsonPrefix))
         {
            result.remove_prefix(jsonPrefix.size());
            write(result);
         }
         else
            value(result);
         break;
      }
      case SQLITE_BLOB:
         value(std::span<const char>{reinterpret_cast<const char*>(sqlite3_column_blob(stmt, i)),
                                     static_cast<std::size_t>(sqlite3_column_bytes(stmt, i))});
         break;
      case SQLITE_NULL:
         write("null");
         break;
   }
}

int ignore_row(void*, int, char**, char**)
{
   return SQLITE_OK;
}

using namespace psibase;
using namespace UserService;

void load_tables(sqlite3* db, std::string_view sql)
{
   std::regex          table_re("\"(history|ui|events).([-a-zA-Z0-9]+).([_a-zA-Z0-9]+)\"");
   std::regex_iterator iter(sql.begin(), sql.end(), table_re);
   decltype(iter)      end;
   std::string         stmt;
   for (const auto& match : std::ranges::subrange(iter, end))
   {
      std::string serviceStr = match[2].str();
      if (serviceStr != AccountNumber{serviceStr}.str())
         continue;
      std::string typeStr = match[3].str();
      if (MethodNumber{typeStr} == MethodNumber{})
         continue;
      stmt += "CREATE VIRTUAL TABLE IF NOT EXISTS \"";
      stmt += match[1].str();
      stmt += '.';
      stmt += serviceStr;
      stmt += '.';
      stmt += typeStr;
      stmt += "\" USING events(db=";
      stmt += match[1].str();
      stmt += ",service=";
      stmt += serviceStr;
      stmt += ",type=";
      stmt += typeStr;
      stmt += ")";
      // ignore errors. the error will be reported later as
      // accessing a table that doesn't exist in the main query
      sqlite3_exec(db, stmt.c_str(), ignore_row, nullptr, nullptr);
      stmt.clear();
   }
}

static std::vector<char> sqlQueryImpl(AccountNumber                   user,
                                      std::string_view                query,
                                      const std::vector<std::string>& params)
{
   sqlite3* db;
   if (int err = sqlite3_open(":memory:", &db))
   {
      abortMessage(std::string("sqlite3_open: ") + sqlite3_errstr(err));
   }
   if (int err = sqlite3_create_module(db, "events", &eventModule, nullptr))
   {
      abortMessage(std::string("sqlite3_create_module: ") + sqlite3_errstr(err));
   }
   if (int err = sqlite3_collation_needed(db, nullptr, &register_collation))
   {
      abortMessage(std::string("sqlite3_collation_needed: ") + sqlite3_errstr(err));
   }
   if (int err = sqlite3_set_clientdata(db, "user", &user, nullptr))
   {
      abortMessage(std::string("sqlite3_set_clientdata: ") + sqlite3_errstr(err));
   }
   load_tables(db, query);
   std::vector<char> result;
   {
      check(query.size() <= std::numeric_limits<int>::max(), "Query too large");
      const char*         ptr = query.data();
      const char*         end = query.data() + query.size();
      bool                firstRow = true;
      result.push_back('[');
      while (ptr != end)
      {
         sqlite3_stmt* stmt;
         if (int err = sqlite3_prepare_v2(db, ptr, static_cast<int>(end - ptr), &stmt, &ptr))
         {
            abortMessage(std::string("sqlite3_prepare_v2: ") + sqlite3_errmsg(db));
         }
         for (std::size_t i = 0; i < params.size(); ++i)
         {
            if (int err = sqlite3_bind_text64(stmt, static_cast<int>(i + 1), params[i].c_str(),
                                              static_cast<sqlite3_uint64>(params[i].size()),
                                              SQLITE_STATIC, SQLITE_UTF8))
            {
               abortMessage(std::string("sqlite3_bind_text64: ") + sqlite3_errmsg(db));
            }
         }
         while (true)
         {
            int err = sqlite3_step(stmt);
            if (err == SQLITE_ROW)
            {
               if (firstRow)
                  firstRow = false;
               else
                  result.push_back(',');
               result.push_back('{');
               int nColumns = sqlite3_column_count(stmt);
               for (int i = 0; i < nColumns; ++i)
               {
                  if (i != 0)
                     result.push_back(',');
                  column_to_json(stmt, i, result);
               }
               result.push_back('}');
            }
            else
            {
               if (err != SQLITE_DONE)
               {
                  abortMessage(std::string("sqlite3_prepare_v2: ") + sqlite3_errmsg(db));
               }
               break;
            }
         }
         if (int err = sqlite3_finalize(stmt))
         {
            abortMessage(std::string("sqlite3_prepare_v2: ") + sqlite3_errmsg(db));
         }
      }
      result.push_back(']');
   }

   return result;
}

std::vector<char> REvents::sqlQuery(const std::string&              query,
                                    const std::vector<std::string>& params)
{
   return sqlQueryImpl(getSender(), query, params);
}

std::optional<HttpReply> REvents::serveSys(const HttpRequest&           request,
                                           std::optional<std::int32_t>  socket,
                                           std::optional<AccountNumber> user)
{
   check(getSender() == SystemService::HttpServer::service, "wrong sender");

   if (request.target != "/sql")
      return {};

   if (!to<LocalService::XAdmin>().isAdmin(user, socket, forwardedFor(request)))
   {
      std::string_view msg = "Not authorized";
      return HttpReply{.status      = user ? HttpStatus::forbidden : HttpStatus::unauthorized,
                       .contentType = "text/html",
                       .body        = std::vector(msg.begin(), msg.end())};
   }

   return HttpReply{
       .contentType = "application/json",
       .body = sqlQueryImpl(AccountNumber{}, {request.body.data(), request.body.size()}, {})};
}

PSIBASE_DISPATCH(UserService::REvents)
