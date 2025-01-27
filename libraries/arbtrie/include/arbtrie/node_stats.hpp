#pragma once

namespace arbtrie {

   struct node_stats
   {
      node_stats()
      {
         memset(node_counts, 0, sizeof(node_counts));
         memset(node_data_size, 0, sizeof(node_data_size));
      }
      int total_nodes() const
      {
         int sum = 0;
         for (auto c : node_counts)
            sum += c;
         return sum;
      }
      int64_t total_size() const
      {
         int64_t sum = 0;
         for (auto c : node_data_size)
            sum += c;
         return sum;
      }
      double average_depth() const { return double(total_depth) / total_nodes(); }
      double average_binary_size() const
      {
         return double(node_data_size[node_type::binary] / node_counts[node_type::binary]);
      }
      double average_value_size() const
      {
         return double(node_data_size[node_type::value] / node_counts[node_type::value]);
      }

      int     node_counts[num_types];
      int64_t node_data_size[num_types];
      int     max_depth   = 0;
      int64_t total_depth = 0;
      int64_t total_keys  = 0;

      friend auto         operator<=>(const node_stats&, const node_stats&) = default;
      inline friend auto& operator<<(auto& stream, const node_stats& s)
      {
         return stream << std::setw(10) << std::right << add_comma(s.total_keys) << " keys | "
                       << std::setw(10) << std::right << add_comma(s.total_nodes()) << " nodes | "
                       << std::setw(10) << std::right << add_comma(s.node_counts[node_type::value])
                       << " value nodes | " << std::setw(10) << std::right
                       << add_comma(s.node_counts[node_type::binary]) << " binary nodes | "
                       << std::setw(10) << std::right
                       << add_comma(s.node_counts[node_type::setlist]) << " setlist nodes | "
                       << std::setw(10) << std::right << add_comma(s.node_counts[node_type::full])
                       << " full nodes | " << std::setw(10) << std::right
                       << s.total_size() / double(GB) << " GB | " << std::setw(10) << std::right
                       << s.average_depth() << " avg depth | " << std::setw(10) << std::right
                       << s.average_binary_size() << " avg binary size | " << std::setw(10)
                       << std::right << s.average_value_size() << " avg value node size | "
                       << std::setw(10) << std::right << s.max_depth << " max depth  ";
      }
   };

}
