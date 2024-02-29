use crate::{version_match, PackageInfo, PackageRef, Version};
use custom_error::custom_error;
use std::collections::{HashMap, HashSet};
use varisat::{ExtendFormula, Lit, Solver};

// The following rules are hard requirements:
// - If a package is installed, then its dependencies must be satified
// - If a package is installed, then no conflicting packages can be installed
// - If a package is installed, then no other version of the same package shall be installed
// - A package is only installed if it is required (transitively) to satisfy the request
//
// In addition, the solver prefers newer versions over older versions.

custom_error! {
    pub Error
        CannotResolvePackages          = "Cannot resolve packages",
    DependencyCycle = "Cycle in service dependencies",
}

pub fn solve_dependencies(
    packages: Vec<PackageInfo>,
    input: Vec<PackageRef>,
    pinned: Vec<PackageRef>,
) -> Result<Vec<PackageInfo>, anyhow::Error> {
    let mut graph = DepGraph::new();
    for package in packages {
        graph.add(package);
    }
    for package in input {
        graph.add_input(package);
    }
    for package in pinned {
        graph.pin(package);
    }
    graph.solve()
}

pub struct DepGraph<'a> {
    packages: HashMap<String, HashMap<String, (PackageInfo, Lit)>>,
    input: Vec<PackageRef>,
    pinned: HashMap<String, String>,
    solver: Solver<'a>,
}

fn topological_sort_impl(
    reg: &mut HashMap<String, PackageInfo>,
    names: &[PackageRef],
    found: &mut HashMap<String, bool>,
    result: &mut Vec<PackageInfo>,
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

// Sorts packages in dependency order. Only includes packages
// that are required by the inputs.
fn topological_sort(
    packages: Vec<PackageInfo>,
    input: &[PackageRef],
    ignore: &HashMap<String, String>,
) -> Result<Vec<PackageInfo>, anyhow::Error> {
    let mut by_name = HashMap::new();
    for package in packages {
        let name = package.name.clone();
        by_name.insert(name, package);
    }
    let mut found = HashMap::new();
    for (name, _) in ignore {
        found.insert(name.clone(), true);
    }
    let mut result = vec![];
    topological_sort_impl(&mut by_name, input, &mut found, &mut result)?;
    Ok(result)
}

impl<'a> DepGraph<'a> {
    pub fn new() -> DepGraph<'a> {
        DepGraph {
            packages: HashMap::new(),
            input: Vec::new(),
            pinned: HashMap::new(),
            solver: Solver::new(),
        }
    }
    pub fn add(&mut self, meta: PackageInfo) {
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
    pub fn pin(&mut self, package: PackageRef) {
        self.pinned.insert(package.name, package.version);
    }
    pub fn solve(&mut self) -> Result<Vec<PackageInfo>, anyhow::Error> {
        self.add_pinned();
        self.add_roots()?;
        self.add_depends()?;
        self.add_conflicts();
        if !self.solver.solve()? {
            Err(Error::CannotResolvePackages)?
        } else {
            loop {
                let model: HashSet<Lit> = self.solver.model().unwrap().into_iter().collect();
                if !self.improve_solution(&model) {
                    let mut result = vec![];
                    for (_, packages) in &self.packages {
                        for (_, (meta, var)) in packages {
                            if model.contains(var) {
                                result.push(meta.clone());
                            }
                        }
                    }
                    return topological_sort(result, &self.input, &self.pinned);
                }
            }
        }
    }
    // Attempts to find a solution that has
    // - No package older than the currently chosen version AND
    // - At least one package newer than the currently chosen version
    // Note that the added clauses are carried through all future iterations
    // even if the packages that they refer to are dropped from the
    // install set. This is necessary to prevent an infinite loop
    // in pathological cases.
    fn improve_solution(&mut self, model: &HashSet<Lit>) -> bool {
        let mut better = vec![];
        for (_, packages) in &self.packages {
            let mut versions: Vec<(String, Lit)> = Vec::new();
            let mut found = None;
            for (_, (meta, var)) in packages {
                if model.contains(var) {
                    found = Some(meta.version.clone());
                } else {
                    versions.push((meta.version.clone(), *var));
                }
            }
            if let Some(current) = found {
                let current_version = Version::new(&current).unwrap();
                for (version, var) in versions {
                    if &Version::new(&version).unwrap() < &current_version {
                        self.solver.add_clause(&[!var]);
                    } else {
                        better.push(var);
                    }
                }
            }
        }
        if better.is_empty() {
            return false;
        }
        self.solver.add_clause(&better);
        self.solver.solve().unwrap_or(false)
    }
    fn get_matching(&self, pattern: &PackageRef) -> Result<Vec<Lit>, anyhow::Error> {
        let mut result = vec![];
        if let Some(packages) = self.packages.get(&pattern.name) {
            for (k, v) in packages {
                if version_match(&pattern.version, k)? {
                    result.push(v.1);
                }
            }
        }
        Ok(result)
    }
    fn add_depends(&mut self) -> Result<(), anyhow::Error> {
        for packages in self.packages.values() {
            for (meta, var) in packages.values() {
                for dep in &meta.depends {
                    if let Some(matched) = self.matches_pinned(dep)? {
                        if !matched {
                            self.solver.add_clause(&[!*var]);
                        }
                    } else {
                        let group = self.get_matching(dep)?;
                        any_if(&mut self.solver, *var, group);
                    }
                }
            }
        }
        Ok(())
    }
    fn add_roots(&mut self) -> Result<(), anyhow::Error> {
        for input in &self.input {
            let group = self.get_matching(input)?;
            any(&mut self.solver, &group);
        }
        Ok(())
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
    fn matches_pinned(&self, package: &PackageRef) -> Result<Option<bool>, anyhow::Error> {
        if let Some(pinned_version) = self.pinned.get(&package.name) {
            Ok(Some(version_match(&package.version, pinned_version)?))
        } else {
            Ok(None)
        }
    }
    fn add_pinned(&mut self) {
        for (name, version) in &self.pinned {
            if let Some(packages) = self.packages.get(name) {
                for (k, v) in packages {
                    if k == version {
                        self.solver.add_clause(&[v.1]);
                    } else {
                        self.solver.add_clause(&[!v.1]);
                    }
                }
            }
        }
    }
}

fn bit_or(solver: &mut Solver, lhs: Lit, rhs: Lit) -> Lit {
    let result = solver.new_lit();
    solver.add_clause(&[result, !rhs]);
    solver.add_clause(&[result, !lhs]);
    solver.add_clause(&[!result, lhs, rhs]);
    result
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
        let a: PackageInfo = serde_json::from_str(
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
        let packages: Vec<PackageInfo> = serde_json::from_str(
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

    fn get_ids(input: &Vec<PackageInfo>) -> Vec<(&str, &str)> {
        let mut result = vec![];
        for meta in input {
            result.push((meta.name.as_str(), meta.version.as_str()));
        }
        result
    }

    #[test]
    fn test_solve_version() -> Result<(), anyhow::Error> {
        let mut graph = DepGraph::new();
        let packages: Vec<PackageInfo> = serde_json::from_str(
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
        let packages: Vec<PackageInfo> = serde_json::from_str(
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
