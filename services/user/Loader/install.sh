
# Function to check for and execute build.sh
check_and_execute_build() {
    local target_dir="$1"
    local build_script="$target_dir/build.sh"

    if [ -f "$build_script" ]; then
        echo "Executing $build_script"
        bash "$build_script"
    fi
}

# Install the loader in the public dir of these services
system_services=("AccountSys")
user_services=("TokenSys")

npm i && npm run build

# Loop through the system directories and execute the command for each
for system_dir in "${system_services[@]}"; do
    root_dir="../../system/$system_dir"
    target_dir="/ui/public/loader"
    full_path="$root_dir$target_dir"

    # Copy files
    echo $full_path
    rm -rf "$full_path" && mkdir -p "$full_path" && cp -R dist/* "$full_path"

    # Check for build.sh and execute if it exists
    check_and_execute_build "$root_dir"
done

# Loop through the user directories and execute the command for each
for user_dir in "${user_services[@]}"; do
    root_dir="../../user/$user_dir"
    target_dir="/ui/public/loader"
    full_path="$root_dir$target_dir"

    # Copy files
    echo $full_path
    rm -rf "$full_path" && mkdir -p "$full_path" && cp -R dist/* "$full_path"

    # Check for build.sh and execute if it exists
    check_and_execute_build "$root_dir"
done
