#pragma once

#include <chrono>
#include <memory>
#include <string>
#include <vector>

namespace psibase
{
   namespace benchmarking
   {
      class BenchmarkData
      {
        public:
         BenchmarkData();
         void print() const;
         void nextColumn();
         void addTime(const std::string& t);

        private:
         unsigned int                          activeColumn;
         std::vector<std::vector<std::string>> timings;
      };

      class Benchmarker
      {
        public:
         using Clock = std::chrono::high_resolution_clock;

         Benchmarker(std::shared_ptr<BenchmarkData> data);
         ~Benchmarker();

        private:
         std::chrono::steady_clock::time_point startClock;
         std::shared_ptr<BenchmarkData>        d;
      };

   }  // namespace benchmarking
}  // namespace psibase