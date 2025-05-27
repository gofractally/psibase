use crate::{version_match, Meta, PackageInfo, PackageRef, Version};
use custom_error::custom_error;
use serde::{Deserialize, Serialize};
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
    PackageNotFound{name: String} = "Package {name} not found",
    PackageVersionNotFound{name: String, version: String} = "No suitable version for {name} ({version})"
}

#[derive(Serialize, Deserialize)]
pub struct PackageDisposition {
    can_break: bool,
    can_remove: bool,
    allowed_versions: String,
}

impl PackageDisposition {
    pub fn pinned(version: &str) -> PackageDisposition {
        PackageDisposition {
            can_break: false,
            can_remove: false,
            allowed_versions: "=".to_string() + version,
        }
    }
    pub fn breakable(version: &str) -> PackageDisposition {
        PackageDisposition {
            can_break: true,
            can_remove: false,
            allowed_versions: "=".to_string() + version,
        }
    }
    pub fn upgradable(version: &str) -> PackageDisposition {
        PackageDisposition {
            can_break: false,
            can_remove: false,
            allowed_versions: ">=".to_string() + version,
        }
    }
    pub fn removable(_version: &str) -> PackageDisposition {
        PackageDisposition {
            can_break: true,
            can_remove: true,
            allowed_versions: ">=0".to_string(),
        }
    }
}

// A package is removed before any packages that it depends on are removed or upgraded (hard, rationale: pre-rm order)
// A package is upgraded before any packages that it depends on are removed (soft, rationale: don't leave broken packages behind on an incomplete upgrade)
// A package is upgraded or installed after any packages that it depends on are upgraded or installed (hard, postinstall order)

// reverse origin graph dropping broken packages - acyclic
// forwards

// Ar <- Bu <- Cr
//
// remove C
// update B
// remove A
//
//struct DepGraph

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum PackageOp {
    Install(PackageInfo),
    Replace(Meta, PackageInfo),
    Remove(Meta),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PackagePreference {
    // Prefer the latest version
    Latest,
    // Prefer the best compatible version
    Compatible,
    // Prefer the current version
    Current,
}

impl PackagePreference {
    fn priority<'a>(&self, installed: &Version, v: &'a Version<'a>) -> (u32, &'a Version<'a>) {
        let pre = if self >= &PackagePreference::Current && v == installed {
            2
        } else if self >= &PackagePreference::Compatible && v.is_compat(installed) {
            1
        } else {
            0
        };
        (pre, v)
    }
}

pub fn solve_dependencies(
    packages: Vec<PackageInfo>,
    input: Vec<PackageRef>,
    existing: Vec<(Meta, PackageDisposition)>,
    preferred_order: Vec<String>,
    reinstall: bool,
    request_pref: PackagePreference,
    non_request_pref: PackagePreference,
) -> Result<Vec<PackageOp>, anyhow::Error> {
    let mut graph = DepGraph::new();
    graph.reinstall = reinstall;
    graph.preferred_order = preferred_order;
    graph.request_pref = request_pref;
    graph.non_request_pref = non_request_pref;
    for package in packages {
        graph.add(package);
    }
    for package in input {
        graph.add_input(package);
    }
    for (package, disp) in existing {
        graph.add_existing(package, disp);
    }
    graph.solve()
}

pub struct DepGraph<'a> {
    packages: HashMap<String, HashMap<String, (PackageInfo, Lit)>>,
    request: HashMap<String, String>,
    existing: HashMap<String, (Meta, PackageDisposition, bool)>,
    preferred_order: Vec<String>,
    solver: Solver<'a>,
    reinstall: bool,
    request_pref: PackagePreference,
    non_request_pref: PackagePreference,
}

fn get_removed_impl(
    reg: &HashMap<String, PackageInfo>,
    names: &[PackageRef],
    existing: &HashMap<String, (Meta, PackageDisposition, bool)>,
    found: &mut HashMap<String, bool>,
    result: &mut Vec<PackageOp>,
) {
    for name in names {
        if !found.contains_key(&name.name) {
            let (package, disp, broken) = existing.get(&name.name).unwrap();
            found.insert(name.name.clone(), true);
            let should_remove = !reg.contains_key(&name.name) && disp.can_remove;
            if !broken {
                get_removed_impl(reg, &package.depends, existing, found, result);
                if should_remove {
                    result.push(PackageOp::Remove(
                        existing.get(&name.name).unwrap().0.clone(),
                    ));
                }
            }
        }
    }
}

fn get_installed_impl(
    reg: &mut HashMap<String, PackageInfo>,
    reinstall: &HashMap<String, String>,
    names: &[PackageRef],
    existing: &mut HashMap<String, (Meta, PackageDisposition, bool)>,
    found: &mut HashMap<String, bool>,
    result: &mut Vec<PackageOp>,
) -> Result<(), anyhow::Error> {
    for name in names {
        if let Some(completed) = found.get(&name.name) {
            if !completed {
                Err(Error::DependencyCycle)?
            }
        } else {
            let (nm, package) = reg.remove_entry(&name.name).unwrap();
            found.insert(nm, false);
            get_installed_impl(reg, reinstall, &package.depends, existing, found, result)?;
            if let Some((meta, _, _)) = existing.remove(&name.name) {
                if meta.version != package.version || reinstall.contains_key(&name.name) {
                    result.push(PackageOp::Replace(meta, package));
                }
            } else {
                result.push(PackageOp::Install(package));
            }
            *found.get_mut(&name.name).unwrap() = true;
        }
    }
    Ok(())
}

// Takes the new and previous sets of packages and returns a list
// of operations in the order in which they should be executed.
//
// A package is installed after and removed before all the packages
// that it depends on.
fn evaluate_changes(
    mut packages: HashMap<String, PackageInfo>,
    mut existing: HashMap<String, (Meta, PackageDisposition, bool)>,
    request: HashMap<String, String>,
    preferred_order: Vec<String>,
    reinstall: bool,
) -> Result<Vec<PackageOp>, anyhow::Error> {
    let existing_refs: Vec<_> = existing
        .keys()
        .map(|name| PackageRef {
            name: name.clone(),
            version: String::new(),
        })
        .collect();
    let mut result = vec![];
    get_removed_impl(
        &packages,
        &existing_refs,
        &existing,
        &mut HashMap::new(),
        &mut result,
    );
    result.reverse();

    let installed_refs: Vec<_> = preferred_order
        .iter()
        .filter(|name| packages.contains_key(*name))
        .chain(packages.keys())
        .map(|name| PackageRef {
            name: name.clone(),
            version: String::new(),
        })
        .collect();
    get_installed_impl(
        &mut packages,
        &if reinstall { request } else { HashMap::new() },
        &installed_refs,
        &mut existing,
        &mut HashMap::new(),
        &mut result,
    )?;
    Ok(result)
}

fn get_selected_version<'a>(
    packages: &'a HashMap<String, (PackageInfo, Lit)>,
    model: &HashSet<Lit>,
) -> Option<&'a str> {
    for (_, (meta, var)) in packages {
        if model.contains(var) {
            return Some(&meta.version);
        }
    }
    None
}

// Optimizes packages
// - Installing a new package is not preferred
// - Uninstalling an existing package is not preferred
// - Otherwise pref determines which version of each package is preferred
fn improve_solution<
    'b,
    'a,
    I: Iterator<Item = (&'b String, &'b HashMap<String, (PackageInfo, Lit)>)>,
>(
    iter: I,
    solver: &mut Solver<'a>,
    existing: &HashMap<String, (Meta, PackageDisposition, bool)>,
    model: &HashSet<Lit>,
    pref: PackagePreference,
) -> bool {
    let mut negated = vec![];
    for (name, packages) in iter {
        if let Some(selected) = get_selected_version(packages, model) {
            let selected_version = Version::new(&selected).unwrap();
            if let Some(existing) = existing.get(name) {
                // newer only
                let existing = Version::new(&existing.0.version).unwrap();
                for (version, (_, var)) in packages {
                    if version != selected {
                        if pref.priority(&existing, &Version::new(&version).unwrap())
                            < pref.priority(&existing, &selected_version)
                        {
                            solver.add_clause(&[!*var]);
                        } else {
                            negated.push(*var);
                        }
                    }
                }
            } else {
                // newer or none
                for (version, (_, var)) in packages {
                    if version == selected {
                        negated.push(!*var);
                    } else if &Version::new(&version).unwrap() < &selected_version {
                        solver.add_clause(&[!*var]);
                    }
                }
            }
        } else {
            if existing.contains_key(name) {
                // allow any
                for (_, (_, var)) in packages {
                    negated.push(*var);
                }
            } else {
                // forbid all
                for (_, (_, var)) in packages {
                    solver.add_clause(&[!*var]);
                }
            }
        }
    }
    solver.add_clause(&negated);
    solver.assume(&[]);
    solver.solve().unwrap_or(false)
}

impl<'a> DepGraph<'a> {
    pub fn new() -> DepGraph<'a> {
        DepGraph {
            packages: HashMap::new(),
            request: HashMap::new(),
            existing: HashMap::new(),
            solver: Solver::new(),
            preferred_order: Vec::new(),
            reinstall: false,
            request_pref: PackagePreference::Latest,
            non_request_pref: PackagePreference::Current,
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
        self.request.insert(input.name, input.version);
    }
    pub fn add_existing(&mut self, meta: Meta, disposition: PackageDisposition) {
        let is_known_package = self
            .packages
            .get(&meta.name)
            .map_or(false, |packages| packages.contains_key(&meta.version));
        if !is_known_package {
            self.add(PackageInfo {
                name: meta.name.clone(),
                version: meta.version.clone(),
                description: meta.description.clone(),
                depends: meta.depends.clone(),
                accounts: meta.accounts.clone(),
                sha256: Default::default(),
                file: String::new(),
            });
        }
        let name = meta.name.clone();
        self.existing.insert(name, (meta, disposition, false));
    }
    pub fn solve(mut self) -> Result<Vec<PackageOp>, anyhow::Error> {
        self.adjust_currently_broken()?;
        self.apply_existing();
        self.add_roots()?;
        self.add_depends()?;
        self.add_conflicts();
        if !self.solver.solve()? {
            Err(Error::CannotResolvePackages)?
        } else {
            let mut request_optimized = false;
            loop {
                let model: HashSet<Lit> = self.solver.model().unwrap().into_iter().collect();
                if !request_optimized {
                    if !self.improve_request_solution(&model) {
                        request_optimized = true;
                    }
                }
                if request_optimized && !self.improve_non_request_solution(&model) {
                    let mut result = HashMap::new();
                    for (_, packages) in self.packages {
                        for (_, (meta, var)) in packages {
                            if model.contains(&var) {
                                let name = meta.name.clone();
                                result.insert(name, meta);
                            }
                        }
                    }
                    return evaluate_changes(
                        result,
                        self.existing,
                        self.request,
                        self.preferred_order,
                        self.reinstall,
                    );
                }
            }
        }
    }
    // Attempts to find a solution that has
    // - No package older than the currently chosen version AND
    // - At least one package newer than the currently chosen version
    // Note that the excluded versions are carried through all future iterations
    // even if the packages that they refer to are dropped from the
    // install set. This is necessary to prevent an infinite loop
    // in pathological cases.
    fn improve_request_solution(&mut self, model: &HashSet<Lit>) -> bool {
        let control = self.solver.new_lit();
        let mut negated = vec![!control];
        for (name, _) in &self.request {
            let packages = self.packages.get(name).unwrap();
            let selected = get_selected_version(packages, model).unwrap();
            let selected_version = Version::new(&selected).unwrap();
            let existing = self.existing.get(name);
            for (version, (_, var)) in packages {
                if version == selected {
                    negated.push(!*var);
                } else {
                    let version = Version::new(&version).unwrap();
                    if let Some(existing) = existing {
                        let existing = Version::new(&existing.0.version).unwrap();
                        if self.request_pref.priority(&existing, &version)
                            < self.request_pref.priority(&existing, &selected_version)
                        {
                            self.solver.add_clause(&[!*var]);
                        }
                    } else {
                        if &version < &selected_version {
                            self.solver.add_clause(&[!*var]);
                        }
                    }
                }
            }
        }
        self.solver.add_clause(&negated);
        self.solver.assume(&[control]);
        self.solver.solve().unwrap_or(false)
    }
    // Optimizes packages that were not part of the request
    // - pref determines which version of each package is preferred
    // - Uninstalling an existing package is not preferred
    // - Otherwise higher precedence is preferred
    fn improve_non_request_solution(&mut self, model: &HashSet<Lit>) -> bool {
        improve_solution(
            self.packages.iter().filter_map(|(name, packages)| {
                if self.request.contains_key(name) {
                    None
                } else {
                    Some((name, packages))
                }
            }),
            &mut self.solver,
            &self.existing,
            model,
            self.non_request_pref,
        )
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
                    let group = self.get_matching(dep)?;
                    if group.is_empty() {
                        eprintln!(
                            "warning: dependency {}-{} -> {} {} not found",
                            meta.name, meta.version, dep.name, dep.version
                        );
                    }
                    any_if(&mut self.solver, *var, group);
                }
            }
        }
        Ok(())
    }
    fn add_roots(&mut self) -> Result<(), anyhow::Error> {
        for (name, version) in &self.request {
            let group = self.get_matching(&PackageRef {
                name: name.clone(),
                version: version.clone(),
            })?;
            if group.is_empty() {
                if self.packages.get(name).is_some() {
                    Err(Error::PackageVersionNotFound {
                        name: name.clone(),
                        version: version.clone(),
                    })?
                } else {
                    Err(Error::PackageNotFound { name: name.clone() })?
                }
            }
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
    // A package is broken if any of its dependencies are missing or broken
    // A broken package can remain broken and will not be removed
    // This function alters the package disposition to reflect this
    fn adjust_currently_broken(&mut self) -> Result<(), anyhow::Error> {
        let mut directly_broken = vec![];
        let mut reverse_graph: HashMap<String, Vec<String>> =
            self.existing.keys().map(|k| (k.clone(), vec![])).collect();
        for (name, (meta, _, _)) in &self.existing {
            let mut broken = false;
            for dep in &meta.depends {
                if !broken {
                    if let Some((package, _, _)) = self.existing.get(&dep.name) {
                        broken = !version_match(&dep.version, &package.version)?;
                    } else {
                        broken = true;
                    }
                }
                reverse_graph.get_mut(&dep.name).unwrap().push(name.clone());
            }
            if broken {
                directly_broken.push(name.clone());
            }
        }
        // transitive closure
        let mut stack = vec![directly_broken];
        while let Some(group) = stack.pop() {
            for package in group {
                if let Some(rdepends) = reverse_graph.remove(&package) {
                    stack.push(rdepends);
                    let (_, disp, broken) = self.existing.get_mut(&package).unwrap();
                    disp.can_break = true;
                    disp.can_remove = false;
                    *broken = true;
                }
            }
        }
        Ok(())
    }
    fn apply_existing(&mut self) {
        for (name, (meta, disp, _)) in &self.existing {
            if let Some(packages) = self.packages.get(name) {
                let mut allowed_versions = vec![];
                let current_version = Version::new(&meta.version).unwrap();
                for (k, v) in packages {
                    if &Version::new(&k).unwrap() < &current_version {
                        self.solver.add_clause(&[!v.1]);
                    } else {
                        allowed_versions.push(v.1);
                    }
                }
                if !disp.can_break {
                    self.solver.add_clause(&allowed_versions);
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
        let graph = DepGraph::new();
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
        assert_eq!(graph.solve()?, vec![PackageOp::Install(a)]);
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
        assert_eq!(
            graph.solve()?,
            packages
                .into_iter()
                .map(|i| PackageOp::Install(i))
                .collect::<Vec<_>>()
        );
        Ok(())
    }

    fn get_ids(input: &Vec<PackageOp>) -> Vec<(&str, &str)> {
        let mut result = vec![];
        for op in input {
            match op {
                PackageOp::Install(meta) => {
                    result.push((meta.name.as_str(), meta.version.as_str()));
                }
                _ => {
                    panic!("Unexpected op: {:?}", op);
                }
            }
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
