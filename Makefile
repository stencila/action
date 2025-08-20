all: fix lint test build

# Install dependencies
install:
ifdef CI
	npm ci
else
	npm install
endif

# Make formatting and linting fixes
fix: install
	npm run fix

# Run linting and type checks
lint: install
	npm run lint
	npm run typecheck

# Run tests
test: install
	npm run test

# Build dist/
build: install clean
	npm run build

# Clean up artifacts
clean:
	rm -rf dist
