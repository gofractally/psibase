# NOTE for integration into CommonSys and build
# - move Loader code to CommonSys
# - separate Loader build from deployment
# - deployment will be just a line in CommonSys package
SERVICES_DIR="/root/psibase/services"

# build Loader code (that will be shared with all apps)
pushd "$SERVICES_DIR/user/CommonSys/common-lib/packages/wasm-loader"
rm -rf dist
rm -rf node_modules
yarn --mutex network && yarn build

# Services that will receive Loader code
system_services=()
user_services=("DemoApp1" "DemoApp2")

# Function to check for and execute build.sh
check_and_execute_build() {
    local target_dir="$1"
    local build_script="$target_dir/build.sh"

    if [ -f "$build_script" ]; then
        echo "Executing $build_script"
        bash "$build_script"
    fi
}

# Loop through the system directories and execute the command for each
for system_dir in "${system_services[@]}"; do
    # echo "Starting system loop..."
    root_dir="$SERVICES_DIR/system/$system_dir"
    target_dir="/ui/public/common/wasm-loader"
    full_path="$root_dir$target_dir"

    # Wipe build products of targeted app
    rm -rf "$full_path" && mkdir -p "$full_path"
    # Copy loader files to that app
    cp -R dist/* "$full_path"

    # Check for build.sh and execute if it exists
    check_and_execute_build "$root_dir"
done

# Loop through the user directories and execute the command for each
for user_dir in "${user_services[@]}"; do
    # echo "Starting user loop..."
    root_dir="$SERVICES_DIR/user/$user_dir"
    target_dir="/ui/public/common/wasm-loader"
    full_path="$root_dir$target_dir"

    # Wipe build products of targeted app
    rm -rf "$full_path" && mkdir -p "$full_path"
    # Copy loader files to that app
    cp -R dist/* "$full_path"

    # Check for build.sh and execute if it exists
    check_and_execute_build "$root_dir"
done

popd