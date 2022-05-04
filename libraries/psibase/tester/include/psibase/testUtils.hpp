#pragma once

#include <chrono>
#include <memory>
#include <string>
#include <vector>

namespace psibase
{
   namespace benchmarking
   {
      /* Usage
         // Create the object that will collect all benchmark data
         auto d = std::make_shared<BenchmarkData>();
         
         // Call actions that touch each of the contracts you're interested in without benchmarking
         // The first time a test accesses a contract should be ignored
         alice.action1();
         alice.action2();

         // Call actions to benchmark in a loop, creating a Benchmarker in the scope of each transaction
         for (int i = 0; i < 30; ++i, d->nextColumn())
         {
            {
               Benchmarker t(d);
               alice.action1();
            }
            {
               Benchmarker t(d);
               alice.action2();
            }
         }

         // Print the data collected by the BenchmarkData object
         d->print();
      */

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