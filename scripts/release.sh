#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the version argument
VERSION=$1

if [ -z "$VERSION" ]; then
    echo -e "${RED}Error: Version number required${NC}"
    echo "Usage: ./scripts/release.sh <version>"
    echo "Example: ./scripts/release.sh 1.0.1"
    exit 1
fi

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Error: Version must be in format X.Y.Z${NC}"
    exit 1
fi

echo -e "${GREEN}Creating release for version $VERSION${NC}"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}Warning: Not on main branch (currently on $CURRENT_BRANCH)${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: You have uncommitted changes${NC}"
    echo "Please commit or stash your changes before releasing"
    exit 1
fi

# Update version in package.json
echo "Updating package.json version to $VERSION..."
npm version $VERSION --no-git-tag-version

# Install dependencies
echo "Installing dependencies..."
npm ci

# Build the action
echo "Building action..."
npm run build

# Check if dist directory exists and has content
if [ ! -d "dist" ] || [ -z "$(ls -A dist)" ]; then
    echo -e "${RED}Error: Build failed - dist directory is empty${NC}"
    exit 1
fi

# Stage changes
echo "Staging changes..."
git add package.json package-lock.json dist/

# Commit changes
echo "Committing changes..."
git commit -m "Release v$VERSION"

# Create and push tag
echo "Creating tag v$VERSION..."
git tag -a "v$VERSION" -m "Release version $VERSION"

# Push commits and tags
echo "Pushing to remote..."
git push origin main
git push origin "v$VERSION"

# Create major version tag (e.g., v1 from v1.0.0)
MAJOR_VERSION=$(echo $VERSION | cut -d. -f1)
echo "Updating major version tag v$MAJOR_VERSION..."
git tag -fa "v$MAJOR_VERSION" -m "Update major version tag to $VERSION"
git push origin "v$MAJOR_VERSION" --force

echo -e "${GREEN}Release v$VERSION created successfully!${NC}"
echo ""
echo "Next steps:"
echo "1. Go to https://github.com/stencila/action/releases/new"
echo "2. Select tag v$VERSION"
echo "3. Set release title to 'v$VERSION'"
echo "4. Add release notes describing the changes"
echo "5. If this is a stable release, check 'Set as the latest release'"
echo "6. Click 'Publish release'"
echo ""
echo "For GitHub Marketplace:"
echo "7. After publishing, click 'Publish this Action to the GitHub Marketplace'"
echo "8. Review and accept the terms if this is the first release"