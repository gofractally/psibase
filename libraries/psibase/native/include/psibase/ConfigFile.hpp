#pragma once

#include <boost/program_options/parsers.hpp>
#include <functional>
#include <iosfwd>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace psibase
{
   // Config file editor that attempts to preserve ordering and comments.
   class ConfigFile
   {
     public:
      // Loads an existing config file.  Comments and property order
      // from the existing file will be preserved.  property values
      // will only be preserved if they are explicitly kept.
      void parse(std::istream& in);
      // Sets the value of a property.  For top level properties, the section
      // should be the empty string.  If a comment is specified, it will be
      // used only when adding a new property to the config file.
      // The value may be automatically enclosed in "" and escaped if it
      // would otherwise fail to round-trip.
      void set(std::string_view section,
               std::string_view key,
               std::string_view value,
               std::string_view comment);
      // Sets a multi-value property
      // The normalize function is used to determine whether two property values
      // are equivalent.
      void set(std::string_view                             section,
               std::string_view                             key,
               const std::vector<std::string>&              values,
               std::function<std::string(std::string_view)> normalize,
               std::string_view                             comment);
      // Preserves the existing values of the key.  This can be used
      // for properties that should not be modified using the HTTP API.
      void keep(std::string_view section, std::string_view key);
      void write(std::ostream& out);

     private:
      struct KeyInfo
      {
         std::vector<std::size_t> enabled;
         std::vector<std::size_t> disabled;
      };
      std::size_t findSection(std::string_view section);
      void        postProcess();
      // every line ends with a \n
      std::vector<std::string>                        lines;
      std::map<std::string, KeyInfo>                  keys;
      std::map<std::size_t, std::string>              insertions;
      std::map<std::string, std::size_t, std::less<>> sectionInsertPoints;
   };

   // Differences from boost::program_options::parse_config_file:
   // - Allows double-quoted strings in value
   //   - # inside a double-quoted string does not begin a comment
   //   - backslash escapes are processed inside double-quoted strings
   boost::program_options::parsed_options parse_config_file(
       std::istream&,
       const boost::program_options::options_description&,
       const std::string& filename = "<unknown>");

}  // namespace psibase
