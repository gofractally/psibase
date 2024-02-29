#include <psibase/semver.hpp>

#include <cassert>
#include <compare>
#include <psibase/check.hpp>
#include <string>
#include <string_view>
#include <vector>

namespace psibase
{

   std::string_view parseDecNum(std::string_view& s)
   {
      std::size_t n = 0;
      for (char ch : s)
      {
         if (ch < '0' || ch > '9')
            break;
         ++n;
      }
      check(n != 0, "Expected number: " + std::string(s));
      check(s[0] != '0' || n == 1, "Leading zero not allowed");
      auto result = s.substr(0, n);
      s.remove_prefix(n);
      return result;
   }

   std::strong_ordering compareDecNum(std::string_view& lhs, std::string_view& rhs)
   {
      auto lnum = parseDecNum(lhs);
      auto rnum = parseDecNum(rhs);
      if (auto result = lnum.size() <=> rnum.size(); result != std::strong_ordering::equal)
         return result;
      return lnum <=> rnum;
   }

   enum class VersionOp
   {
      eq,
      ne,
      lt,
      le,
      gt,
      ge,
      compat,
      patch,
   };

   bool tryConsume(std::string_view& s, char ch)
   {
      if (s.empty())
         return false;
      if (s[0] != ch)
         abortMessage(std::string("expected ") + ch);
      s.remove_prefix(1);
      return true;
   }

   bool consumeChar(std::string_view& lhs, std::string_view& rhs, char ch)
   {
      if (!tryConsume(lhs, ch))
         return false;
      if (!rhs.starts_with(ch))
         abortMessage(std::string("expected ") + ch);
      rhs.remove_prefix(1);
      return true;
   }

   std::string_view consumeIdent(std::string_view& s)
   {
      auto pos    = s.find_first_of(".+");
      auto result = s.substr(0, pos);
      if (pos != std::string_view::npos)
      {
         s.remove_prefix(pos);
      }
      else
      {
         s = {};
      }
      return result;
   }

   bool isPrerelease(std::string_view version)
   {
      auto pos = version.find_first_of("-+");
      return pos != std::string_view::npos || version[pos] == '-';
   }

   // Both strings should start after the patch version (i.e. at the '-', if there is one)
   std::weak_ordering comparePrerelease(std::string_view pattern, std::string_view version)
   {
      // a pre-release version has lower precedence than a normal version
      bool lpre = pattern.starts_with('-');
      bool rpre = version.starts_with('-');
      if (!lpre && !rpre)
         return std::weak_ordering::equivalent;
      if (lpre && !rpre)
         return std::weak_ordering::less;
      if (!lpre && rpre)
         return std::weak_ordering::greater;

      while (true)
      {
         pattern.remove_prefix(1);
         version.remove_prefix(1);

         auto lid    = consumeIdent(pattern);
         auto rid    = consumeIdent(pattern);
         bool lisnum = lid.find_first_not_of("0123456789") == std::string::npos;
         bool risnum = rid.find_first_not_of("0123456789") == std::string::npos;
         // Numeric identifiers always have lower precedence than non-numeric identifiers
         if (lisnum && !risnum)
            return std::weak_ordering::less;
         if (!lisnum && risnum)
            return std::weak_ordering::greater;
         // identifiers consisting of only digits are compared numerically
         if (lisnum)
         {
            // If two numbers have the same number of digits, numeric order
            // is equivalent to ASCII order. Otherwise, the one with more
            // digits is greater.
            if (auto result = lid.size() <=> rid.size(); result != std::strong_ordering::equal)
               return result;
         }
         // Identifiers with letters or hyphens are compared lexically in ASCII sort order
         if (auto result = lid <=> rid; result != std::strong_ordering::equal)
            return result;

         // Check if there is another component
         bool lnext = pattern.starts_with('.');
         bool rnext = version.starts_with('.');
         // a larger set of pre-release fields has a higher precedence than a smaller set
         if (!lnext && !rnext)
            return std::weak_ordering::equivalent;
         if (lnext && !rnext)
            return std::weak_ordering::greater;
         if (!lnext && rnext)
            return std::weak_ordering::less;
      }
   }

   std::weak_ordering comparePattern(std::string_view pattern, std::string_view version)
   {
      if (pattern == "*")
         return std::weak_ordering::equivalent;

      if (auto result = compareDecNum(pattern, version); result != 0)
         return result;
      if (!consumeChar(pattern, version, '.'))
         return std::weak_ordering::equivalent;
      if (auto result = compareDecNum(pattern, version); result != 0)
         return result;
      if (!consumeChar(pattern, version, '.'))
         return std::weak_ordering::equivalent;
      if (auto result = compareDecNum(pattern, version); result != 0)
         return result;

      return comparePrerelease(pattern, version);
   }

   struct VersionMatch
   {
      VersionOp        op;
      std::string_view pattern;
      bool             match(std::string_view version) const
      {
         switch (op)
         {
            case VersionOp::eq:
               return comparePattern(pattern, version) == 0;
            case VersionOp::ne:
               return comparePattern(pattern, version) != 0;
            case VersionOp::lt:
               return comparePattern(pattern, version) > 0;
            case VersionOp::le:
               return comparePattern(pattern, version) >= 0;
            case VersionOp::gt:
               return comparePattern(pattern, version) < 0;
            case VersionOp::ge:
               return comparePattern(pattern, version) <= 0;
            case VersionOp::compat:
            case VersionOp::patch:
            {
               auto copy = pattern;
               if (copy == "*")
                  return !isPrerelease(version);
               if (auto result = compareDecNum(copy, version); result != 0)
                  return false;
               // minor version
               if (!consumeChar(copy, version, '.'))
                  return !isPrerelease(version);
               if (auto result =
                       matchNum(copy, version, pattern.starts_with("0") || op == VersionOp::patch))
                  return *result;
               // patch version
               if (!consumeChar(copy, version, '.'))
                  return !isPrerelease(version);
               if (auto result = matchNum(copy, version, pattern.starts_with("0.0")))
                  return *result;
               return comparePrerelease(copy, version) == 0;
            }
         }
      }
      static std::optional<bool> matchNum(std::string_view& lhs, std::string_view& rhs, bool exact)
      {
         if (exact)
         {
            if (auto result = compareDecNum(lhs, rhs); result != 0)
               return false;
         }
         else
         {
            if (auto result = compareDecNum(lhs, rhs); result > 0)
               return false;
            else if (result < 0)
               return !isPrerelease(rhs);
         }
         return {};
      }
      // where to branch after this test
      long dest[2];
   };

   // A pattern is represented as a DAG of primitive tests.
   // All edges go forwards, and the result of the last test
   // is the final result.
   //
   // For example, the expression A && B || C is compiled to
   // A(true) -> B
   // A(false) -> C
   // B(true) -> done
   // B(false) -> C
   // C(true) -> done
   // C(false) -> done
   //
   // This is accomplished by applying the following rules:
   // A && B
   //   - A(true) -> B
   //   - A(false) -> same target as B(false)
   // A || B
   //   - A(true) -> same target as B(true)
   //   - A(false) -> B
   struct VersionExpr
   {
      std::vector<VersionMatch> items;
      bool                      match(std::string_view version) const
      {
         long i = 0;
         long n = items.size();
         bool result;
         while (i < n)
         {
            result = items[i].match(version);
            i      = items[i].dest[result];
         }
         return result;
      }
   };

   enum class VersionStackItem : long
   {
      and_  = -1,
      or_   = -2,
      comma = -3,
      group = -4,
      // non-negative values are indexes into the items array
   };

   struct VersionExprParser
   {
      VersionExpr parse(std::string_view expr)
      {
         while (true)
         {
         VERSION:
            consume_ws(expr);
            {
               if (consume_token(expr, "("))
               {
                  stack.push_back(VersionStackItem::group);
                  goto VERSION;
               }
               auto op = VersionOp::compat;
               if (consume_token(expr, "="))
                  op = VersionOp::eq;
               else if (consume_token(expr, "!="))
                  op = VersionOp::ne;
               else if (consume_token(expr, "<="))
                  op = VersionOp::le;
               else if (consume_token(expr, "<"))
                  op = VersionOp::lt;
               else if (consume_token(expr, ">="))
                  op = VersionOp::ge;
               else if (consume_token(expr, ">"))
                  op = VersionOp::gt;
               else if (consume_token(expr, "^"))
                  op = VersionOp::compat;
               else if (consume_token(expr, "~"))
                  op = VersionOp::patch;
               consume_ws(expr);
               stack.push_back(static_cast<VersionStackItem>(items.size()));
               items.push_back(consume_version(expr, op));
            }
         OPERATOR:
            consume_ws(expr);
            if (expr.empty())
            {
               break;
            }
            else if (consume_token(expr, ")"))
            {
               stack.push_back(pop_group());
               goto OPERATOR;
            }
            else if (consume_token(expr, "&&"))
            {
               stack.push_back(pop_binop(VersionStackItem::and_));
               stack.push_back(VersionStackItem::and_);
            }
            else if (consume_token(expr, "||"))
            {
               stack.push_back(pop_binop(VersionStackItem::or_));
               stack.push_back(VersionStackItem::or_);
            }
            else if (consume_token(expr, ","))
            {
               stack.push_back(pop_binop(VersionStackItem::comma));
               stack.push_back(VersionStackItem::comma);
            }
            else
            {
               abortMessage("Expected operator");
            }
         }
         auto end = pop_binop(VersionStackItem::comma);
         check(stack.empty(), "Expected )");
         assert(static_cast<std::size_t>(end) == items.size() - 1);
         // Set branches for the final test to the sentinel value
         items.back().dest[0] = items.size();
         items.back().dest[1] = items.size();
         // resolve all branches by working backwards (aliases always point forwards)
         for (long i = items.size(); i > 0;)
         {
            --i;
            for (long& id : items[i].dest)
            {
               if (id <= 0)
               {
                  id = *branch(id);
               }
            }
         }
         return VersionExpr{std::move(items)};
      }
      static VersionMatch consume_version(std::string_view& expr, VersionOp op)
      {
         auto         end = expr.find_first_of("()&|!=<>^~, \t");
         VersionMatch result{.op = op, .pattern = expr.substr(0, end)};
         if (end == std::string_view::npos)
         {
            expr = {};
         }
         else
            expr.remove_prefix(end);
         return result;
      }
      static void consume_ws(std::string_view& expr)
      {
         auto pos = expr.find_first_not_of(" \t");
         if (pos == std::string_view::npos)
            expr = {};
         else
            expr.remove_prefix(pos);
      }
      static bool consume_token(std::string_view& expr, std::string_view token)
      {
         if (expr.starts_with(token))
         {
            expr.remove_prefix(token.size());
            return true;
         }
         return false;
      }
      VersionStackItem pop_version()
      {
         auto result = stack.back();
         stack.pop_back();
         return result;
      }
      VersionStackItem pop_binop(VersionStackItem min)
      {
         auto top = pop_version();
         while (!stack.empty() && stack.back() >= min)
         {
            auto op = stack.back();
            stack.pop_back();
            auto prev = pop_version();
            apply_binop(op, prev, top);
         }
         return top;
      }
      void apply_binop(VersionStackItem op, VersionStackItem lhs, VersionStackItem rhs)
      {
         auto next = static_cast<VersionStackItem>(static_cast<long>(lhs) + 1);
         switch (op)
         {
            case VersionStackItem::and_:
            case VersionStackItem::comma:
               branch_unify(branch_id(lhs, false), branch_id(rhs, false));
               branch_set(branch_id(lhs, true), next);
               break;
            case VersionStackItem::or_:
               branch_unify(branch_id(lhs, true), branch_id(rhs, true));
               branch_set(branch_id(lhs, false), next);
               break;
            default:
               assert(!"Wrong binary op");
         }
      }
      VersionStackItem pop_group()
      {
         auto result = pop_binop(VersionStackItem::comma);
         check(!stack.empty() && stack.back() == VersionStackItem::group, "Unexpected )");
         stack.pop_back();
         return result;
      }
      long branch_id(VersionStackItem idx, bool pass)
      {
         return -(static_cast<long>(idx) * 2 + (pass ? 1 : 0));
      }
      long* branch(long idx) { return &items[(-idx) / 2].dest[idx & 1]; }
      void  branch_unify(long lhs, long rhs) { *branch(lhs) = rhs; }
      void  branch_set(long src, VersionStackItem dest) { *branch(src) = static_cast<long>(dest); }
      std::vector<VersionMatch>     items;
      std::vector<VersionStackItem> stack;
   };

   bool versionMatch(std::string_view lhs, std::string_view rhs)
   {
      return VersionExprParser{}.parse(lhs).match(rhs);
   }

   std::weak_ordering versionCompare(std::string_view lhs, std::string_view rhs)
   {
      if (auto result = compareDecNum(lhs, rhs); result != 0)
         return result;
      if (!consumeChar(lhs, rhs, '.'))
         abortMessage("expected .");
      if (auto result = compareDecNum(lhs, rhs); result != 0)
         return result;
      if (!consumeChar(lhs, rhs, '.'))
         abortMessage("expected .");
      if (auto result = compareDecNum(lhs, rhs); result != 0)
         return result;

      return comparePrerelease(lhs, rhs);
   }
}  // namespace psibase
