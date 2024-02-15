use crate::{version_match, Meta, PackageRef};
use custom_error::custom_error;
use std::collections::{HashMap, HashSet};
use varisat::{ExtendFormula, Lit, Solver};

// a requires b or c
// each package is a variable

// A package must not be installed unless at least one of the following holds:
// - It is in the input set
// - A package that depends on it is installed

// If a package is installed, then its dependencies must be satified
// If a package is installed, then no conflicting packages can be installed
// If a package is installed, then no other version of the same package shall be installed

// Minimize out-dated input packages
// then minimize out-dated dep packages
//
// A package is out-dated if an old version is installed

// A solution A is better than solution B if
// for every package that A and B have in common,
// A is at least as recent as B
// AND
// A has at least one package that is more recent than B
// This is not a partial ordering

custom_error! {
    pub Error
        CannotResolvePackages          = "Cannot resolve packages",
    DependencyCycle = "Cycle in service dependencies",
}

pub struct DepGraph<'a> {
    packages: HashMap<String, HashMap<String, (Meta, Lit)>>,
    input: Vec<PackageRef>,
    solver: Solver<'a>,
}

// Two packages conflict

fn topological_sort_impl(
    reg: &mut HashMap<String, Meta>,
    names: &[PackageRef],
    found: &mut HashMap<String, bool>,
    result: &mut Vec<Meta>,
) -> Result<(), anyhow::Error> {
    for name in names {
        if let Some(completed) = found.get(&name.name) {
            if !completed {
                Err(Error::DependencyCycle)?
            }
        } else {
            let (nm, package) = reg.remove_entry(&name.name).unwrap();
            found.insert(nm, false);
            topological_sort_impl(reg, &package.depends, found, result)?;
            result.push(package);
            *found.get_mut(&name.name).unwrap() = true;
        }
    }
    Ok(())
}

fn topological_sort(packages: Vec<Meta>, input: &[PackageRef]) -> Result<Vec<Meta>, anyhow::Error> {
    let mut by_name = HashMap::new();
    for package in packages {
        let name = package.name.clone();
        by_name.insert(name, package);
    }
    let mut result = vec![];
    topological_sort_impl(&mut by_name, input, &mut HashMap::new(), &mut result)?;
    Ok(result)
}

impl<'a> DepGraph<'a> {
    pub fn new() -> DepGraph<'a> {
        DepGraph {
            packages: HashMap::new(),
            input: Vec::new(),
            solver: Solver::new(),
        }
    }
    // first collect set of potential packages
    // then apply all rules
    // then iteratively relax optimization rules until a match is found
    pub fn add(&mut self, meta: Meta) {
        let name = meta.name.clone();
        let version = meta.version.clone();
        let value = (meta, self.solver.new_lit());
        self.packages
            .entry(name)
            .or_insert(HashMap::new())
            .entry(version)
            .or_insert(value);
    }
    pub fn add_input(&mut self, input: PackageRef) {
        self.input.push(input);
    }
    pub fn solve(&mut self) -> Result<Vec<Meta>, anyhow::Error> {
        self.add_roots();
        self.add_depends();
        self.add_conflicts();
        if !self.solver.solve()? {
            Err(Error::CannotResolvePackages)?
        } else {
            let mut result = vec![];
            let model: HashSet<Lit> = self.solver.model().unwrap().into_iter().collect();
            for (_, packages) in &self.packages {
                for (_, (meta, var)) in packages {
                    if model.contains(var) {
                        result.push(meta.clone());
                    }
                }
            }
            topological_sort(result, &self.input)
        }
    }
    fn get_matching(&self, pattern: &PackageRef) -> Vec<Lit> {
        let mut result = vec![];
        if let Some(packages) = self.packages.get(&pattern.name) {
            for (k, v) in packages {
                if version_match(&pattern.version, k).unwrap() {
                    result.push(v.1);
                }
            }
        }
        result
    }
    fn add_depends(&mut self) {
        for packages in self.packages.values() {
            for (meta, var) in packages.values() {
                for dep in &meta.depends {
                    let group = self.get_matching(dep);
                    any_if(&mut self.solver, *var, group);
                }
            }
        }
    }
    fn add_roots(&mut self) {
        for input in &self.input {
            let group = self.get_matching(input);
            any(&mut self.solver, &group);
        }
    }
    fn add_conflicts(&mut self) {
        // partition packages by name
        let mut packages_by_name: HashMap<String, Vec<Lit>> = HashMap::new();
        for packages in self.packages.values() {
            for (meta, var) in packages.values() {
                packages_by_name
                    .entry(meta.name.clone())
                    .or_insert(vec![])
                    .push(*var);
            }
        }
        for group in packages_by_name.values() {
            zero_or_one_of(&mut self.solver, group);
        }
    }
}

fn bit_and(solver: &mut Solver, lhs: Lit, rhs: Lit) -> Lit {
    let result = solver.new_lit();
    solver.add_clause(&[result, !lhs, !rhs]);
    solver.add_clause(&[!result, lhs]);
    solver.add_clause(&[!result, rhs]);
    result
}

fn bit_xor(solver: &mut Solver, lhs: Lit, rhs: Lit) -> Lit {
    let result = solver.new_lit();
    solver.add_clause(&[!result, lhs, rhs]);
    solver.add_clause(&[result, lhs, !rhs]);
    solver.add_clause(&[result, !lhs, rhs]);
    solver.add_clause(&[!result, !lhs, !rhs]);
    result
}

fn bit_add(solver: &mut Solver, lhs: Lit, rhs: Lit) -> (Lit, Lit) {
    let result = bit_xor(solver, lhs, rhs);
    let carry = bit_and(solver, lhs, rhs);
    (result, carry)
}

fn bit_or(solver: &mut Solver, lhs: Lit, rhs: Lit) -> Lit {
    let result = solver.new_lit();
    solver.add_clause(&[result, !rhs]);
    solver.add_clause(&[result, !lhs]);
    solver.add_clause(&[!result, lhs, rhs]);
    result
}

fn num_bit_add(solver: &mut Solver, bits: &mut [Lit], value: Lit, max: usize) -> Option<Lit> {
    // TODO: don't calculate unnecessary final carry
    let mut carry = value;
    for bit in bits {
        (carry, *bit) = bit_add(solver, *bit, carry);
    }
    if (max + 1) & max == 0 {
        Some(carry)
    } else {
        None
    }
}

pub fn count(solver: &mut Solver, vars: &[Lit]) -> Vec<Lit> {
    let mut total = vec![];
    let mut i = 0;
    for var in vars {
        if let Some(carry) = num_bit_add(solver, &mut total, *var, i) {
            total.push(carry);
        }
        i += 1;
    }
    total
}

fn zero_or_one_of(solver: &mut Solver, vars: &[Lit]) {
    let mut carry = None;
    for var in vars {
        if let Some(c) = carry {
            carry = Some(bit_or(solver, c, *var));
            solver.add_clause(&[!c, !*var]);
        } else {
            carry = Some(*var);
        }
    }
}

fn any(solver: &mut Solver, vars: &[Lit]) {
    solver.add_clause(vars);
}

fn any_if(solver: &mut Solver, x: Lit, deps: Vec<Lit>) {
    let mut clause = deps;
    clause.push(!x);
    solver.add_clause(&clause);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_solve_empty() -> Result<(), anyhow::Error> {
        let mut graph = DepGraph::new();
        assert_eq!(graph.solve()?, vec![]);
        Ok(())
    }

    #[test]
    fn test_solve_one() -> Result<(), anyhow::Error> {
        let mut graph = DepGraph::new();
        let a: Meta = serde_json::from_str(
            r#"{"name":"A","description":"","version":"1.0.0","depends":[],"accounts":[]}"#,
        )?;
        graph.add(a.clone());
        graph.add_input(PackageRef {
            name: "A".to_string(),
            version: "1.0.0".to_string(),
        });
        assert_eq!(graph.solve()?, vec![a]);
        Ok(())
    }

    #[test]
    fn test_solve_simple_dep() -> Result<(), anyhow::Error> {
        let mut graph = DepGraph::new();
        let packages: Vec<Meta> = serde_json::from_str(
            r#"[
{"name":"A","description":"","version":"1.0.0","depends":[],"accounts":[]},
{"name":"B","description":"","version":"1.0.0","depends":[{"name":"A","version":"1.0.0"}],"accounts":[]}
]"#,
        )?;
        for package in &packages {
            graph.add(package.clone());
        }
        graph.add_input(PackageRef {
            name: "B".to_string(),
            version: "1.0.0".to_string(),
        });
        assert_eq!(graph.solve()?, packages);
        Ok(())
    }

    fn get_ids(input: &Vec<Meta>) -> Vec<(&str, &str)> {
        let mut result = vec![];
        for meta in input {
            result.push((meta.name.as_str(), meta.version.as_str()));
        }
        result
    }

    #[test]
    fn test_solve_version() -> Result<(), anyhow::Error> {
        let mut graph = DepGraph::new();
        let packages: Vec<Meta> = serde_json::from_str(
            r#"[
{"name":"A","description":"","version":"1.0.0","depends":[],"accounts":[]},
{"name":"A","description":"","version":"1.1.0","depends":[],"accounts":[]},
{"name":"B","description":"","version":"1.0.0","depends":[{"name":"A","version":"1.0.0"}],"accounts":[]},
{"name":"B","description":"","version":"1.1.0","depends":[{"name":"A","version":"1.2.0"}],"accounts":[]}
]"#,
        )?;
        for package in &packages {
            graph.add(package.clone());
        }
        graph.add_input(PackageRef {
            name: "B".to_string(),
            version: "1.0.0".to_string(),
        });
        assert_eq!(get_ids(&graph.solve()?), [("A", "1.1.0"), ("B", "1.0.0")]);
        Ok(())
    }

    #[test]
    fn test_version_select() -> Result<(), anyhow::Error> {
        let mut graph = DepGraph::new();
        let packages: Vec<Meta> = serde_json::from_str(
            r#"[
{"name":"A","description":"","version":"1.0.0","depends":[],"accounts":[]},
{"name":"A","description":"","version":"1.1.0","depends":[],"accounts":[]},
{"name":"A","description":"","version":"1.2.0","depends":[],"accounts":[]},
{"name":"A","description":"","version":"1.3.0","depends":[],"accounts":[]},
{"name":"A","description":"","version":"1.4.0","depends":[],"accounts":[]},
{"name":"A","description":"","version":"1.5.0","depends":[],"accounts":[]},
{"name":"B","description":"","version":"1.0.0","depends":[{"name":"A","version":"1.2.0"}],"accounts":[]}
]"#,
        )?;
        for package in &packages {
            graph.add(package.clone());
        }
        graph.add_input(PackageRef {
            name: "B".to_string(),
            version: "1.0.0".to_string(),
        });
        assert_eq!(get_ids(&graph.solve()?), [("A", "1.5.0"), ("B", "1.0.0")]);
        Ok(())
    }
}
