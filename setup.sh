#!/usr/bin/env bash
#
# Copies over the environment variables and runs installation of all system
# dependencies.
#
# Confirm the user and group IDs.
echo "User Information:"
echo "-----------------"
echo "Username: $(whoami)"
echo "User ID: $(id -u)"
echo "Group Name: $(id -gn)"
echo "Group ID: $(id -g)"
#
# By default, `bash` runs processes from the working directory of the calling
# process. Since we are copying files back and forth, change to script's
# directory instead.
pushd "$(dirname "$0")" > /dev/null || exit 1
echo "Now running from: $(pwd)"

echo "Updating sysctl configuration..."
sudo sysctl fs.inotify.max_user_watches=524288
sudo sysctl fs.inotify.max_user_instances=8192

echo "Installing shellcheck for the husky pre-commit hook..."
sudo apt-get update
sudo apt-get install -y --no-install-recommends shellcheck
sudo rm -rf /var/lib/apt/lists/*

brew tap dorkitude/linctl
brew install linctl

# NOTE: May need to authenticate using linctl auth.
linctl auth status

popd || exit 1
