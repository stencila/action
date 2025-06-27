# Stencila Action

A GitHub Action to setup and use Stencila CLI in your workflows. This action installs the Stencila CLI tool and optionally runs Stencila commands like `lint` and `render` on your executable documents.

## Usage

### Basic Setup

Just install Stencila CLI without running any commands:

```yaml
- uses: stencila/action@v1
```

### Install and Run Commands

Install Stencila CLI and run a command using the simplified syntax:

```yaml
- uses: stencila/action@v1
  with:
    render: report.smd
```

Or using the alternative syntax:

```yaml
- uses: stencila/action@v1
  with:
    command: lint
    args: report.smd
```

### Complete Workflow Examples

#### Lint Documents

```yaml
name: Lint Documents
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: stencila/action@v1
        with:
          lint: "**/*.smd"
```

#### Render Documents and Store Assets

```yaml
name: Render Documents
on: [push, pull_request]

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: stencila/action@v1
        with:
          render: report.smd 
          assets: "*.pdf"
```

## Inputs

| Input               | Description                                                  | Required | Default   |
| ------------------- | ------------------------------------------------------------ | -------- | --------- |
| `version`           | Version of Stencila CLI to install (e.g., "latest", "2.0.0") | No       | `latest`  |
| `command`           | Stencila command to run (e.g., "lint", "release", "push")    | No       | -         |
| `args`              | Arguments to pass to the Stencila command                    | No       | -         |
| `convert`           | Shortcut for `command: convert` with these arguments         | No       | -         |
| `lint`              | Shortcut for `command: lint` with these arguments            | No       | -         |
| `execute`           | Shortcut for `command: execute` with these arguments         | No       | -         |
| `render`            | Shortcut for `command: render` with these arguments          | No       | -         |
| `assets`           | Path pattern for files to upload as artifacts                | No       | -         |
| `artifact-name`      | Name for the uploaded artifact                               | No       | `assets` |
| `releases`           | Enable releases on tags. When set to `true` (the default) uses the `assets` path pattern, but can also be set as a custom path pattern for releases | No       | `true`   |
| `release-name`      | Template string or file for release name (auto-detects `release-name.*`)           | No       | -         |
| `release-notes`     | Template string or file for release notes (auto-detects `release-notes.*`)      | No       | -         |
| `release-filenames`     | Template string or file for renaming release assets | No       | -         |
| `cache`             | Whether to cache the .stencila folder between runs           | No       | `true`    |
| `working-directory` | Working directory to run Stencila commands                   | No       | `.`       |

## Outputs

| Output      | Description                                    |
| ----------- | ---------------------------------------------- |
| `version`   | The version of Stencila CLI that was installed |
| `exit-code` | Exit code from the Stencila command            |

## Advanced Usage

### Storing output assets

After successfully rendering documents, you can automatically upload the output files as GitHub Actions artifacts:

```yaml
- uses: stencila/action@v1
  with:
    render: "report.smd report.docx"
    assets: "*.docx"
```

This is useful for:

- Preserving rendered documents (PDFs, HTML, etc.) from CI runs
- Sharing assets with team members
- Creating downloadable assets for releases

You can use glob patterns to match multiple files:

```yaml
- uses: stencila/action@v1
  with:
    render: "**/*.smd"
    assets: |
      **/*.pdf
      **/*.html
      !**/temp.*
```

### GitHub Releases

Automatically create GitHub releases when tags are pushed and upload rendered documents as release assets:

```yaml
- uses: stencila/action@v1
  with:
    render: "report.smd report.pdf"
    assets: "*.pdf"
    releases: true  # Uses assets pattern for release files
    release-name: "Report Release"
    release-notes: "Automated release with rendered documents"
```

#### Prerequisites

Releases are **only created when pushing tags**. Your workflow must be triggered by tag pushes:

```yaml
# Option 1: Only run on tags
on:
  push:
    tags: ['v*']

# Option 2: Run on all pushes (including tags) and PRs
on: [push, pull_request]

# Option 3: Explicit configuration
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
```

**Important**: The action checks if `GITHUB_REF` starts with `refs/tags/`. Regular branch pushes or pull requests will not trigger release creation, even if `releases: true` is set.

This feature:
- **Detects tags automatically**: Only runs when `GITHUB_REF` starts with `refs/tags/`
- **Creates releases**: Uses the tag name as the release name (unless overridden)
- **Uploads individual files**: Each file becomes a separate downloadable asset (not zipped)
- **Supports glob patterns**: Match multiple files with patterns like `dist/**/*`
- **Auto-detects release files**: Automatically finds `release-notes.*`, `release-name.*`, and `release-filenames.*` files
- **Template rendering**: Uses Stencila to render templates with variables like `{{ tag }}`, `{{ date }}`

#### Release with Custom Pattern

```yaml
- uses: stencila/action@v1
  with:
    render: "**/*.smd"
    releases: "**/*.pdf"  # Custom pattern for release files
    release-notes: "CHANGELOG.md"  # Read notes from file
```

#### Auto-Detection of Release Files

The action automatically detects release files in your repository root without needing to specify them:

**Auto-detected files** (case-insensitive, `-` or `_` variations):
- `release-notes.*` → Used for release notes (e.g., `RELEASE_NOTES.md`, `release_notes.smd`)
- `release-name.*` → Used for release name (e.g., `release-name.txt`, `RELEASE_NAME.smd`)

**Available template variables:**
- `{{ tag }}` - Git tag name (e.g., "v1.2.0")
- `{{ date }}` - Date (e.g., "2025-01-26")
- `{{ datetime }}` - Full datetime (e.g., "2025-01-26 14:30:15")
- `{{ year }}`, `{{ month }}`, `{{ day }}` - Date components
- `{{ monthname }}` - Month name (e.g., "January")
- `{{ commit }}` - Short commit SHA (e.g., "a1b2c3d")
- `{{ repo }}`, `{{ owner }}` - Repository info
- `{{ workflow }}` - Workflow name
- `{{ build }}` - Build number

**Example `release-notes.smd`:**

```markdown
# {{ repo }} Release {{ tag }}

Released on {{ monthname }} {{ day }}, {{ year }}

This release contains improvements and fixes for {{ repo }}.

Build: {{ build }} | Commit: {{ commit }}
```

#### Workflow Setup for Releases

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # Required for creating releases
    steps:
      - uses: actions/checkout@v4
      
      - uses: stencila/action@v1
        with:
          render: "docs/report.smd"
          assets: "docs/*.pdf"
          releases: true  # Will auto-detect release-notes.* files
```

### Template-Based Asset Renaming

Rename uploaded files using Stencila templates with access to file-specific variables:

```yaml
- uses: stencila/action@v1
  with:
    render: "docs/*.smd"
    releases: "docs/*.pdf"
    release-filenames: "{{ repo }}-{{ tag }}-{{ filestem }}.{{ fileext }}"
```

This feature allows you to:
- **Rename release assets**: Give files meaningful names during upload
- **Use template variables**: Access both standard variables (tag, date, etc.) and file-specific ones
- **Support both string templates and files**: Use inline templates or separate template files

**Available file-specific variables:**
- `{{ filepath }}` - Full file path (e.g., "docs/report.pdf")
- `{{ dirname }}` - Directory name (e.g., "docs")
- `{{ filename }}` - Full filename (e.g., "report.pdf")
- `{{ filestem }}` - Filename without extension (e.g., "report")
- `{{ fileext }}` - File extension (e.g., ".pdf")
- `{{ filesize }}` - File size in bytes

**Example with template file:**

Create `asset-rename.smd`:

```markdown
{{ repo }}_{{ tag }}_{{ filestem }}{{ fileext }}
```

Use in workflow:
```yaml
- uses: stencila/action@v1
  with:
    render: "**/*.smd"
    releases: "**/*.pdf"
    release-filenames: "asset-rename.smd"
```

This would rename files like:
- `report.pdf` → `myrepo_v1.2.0_report.pdf`
- `summary.pdf` → `myrepo_v1.2.0_summary.pdf`

### Custom Working Directory

Run commands in a specific directory:

```yaml
- uses: stencila/action@v1
  with:
    lint: report.smd
    working-directory: ./docs
```

**Important**: All path patterns (`assets`, `releases`, file arguments) are relative to the `working-directory`:
- Auto-detected files (`release-notes.*`, `release-name.*`, `release-filenames.*`) are searched for in the working directory
- With `working-directory: docs` and `assets: "*.pdf"`, the action looks for `docs/*.pdf`
- With `working-directory: .` (default) and `releases: "dist/*"`, the action looks for `dist/*` from the repository root

### Specific Version

Install a specific version of Stencila CLI:

```yaml
- uses: stencila/action@v1
  with:
    version: 2.0.0
    lint: report.smd
```

### Caching

By default, this action caches the `.stencila` folder between runs to speed up subsequent executions. The cache is keyed by operating system, `stencila` version & Git commit SHA.

To disable caching:

```yaml
- uses: stencila/action@v1
  with:
    execute: report.smd
    cache: false
```

## License

This action is licensed under the Apache-2.0. See [LICENSE.md](LICENSE.md) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/stencila/action/issues) page.

## Releasing

To create a new release, run:

```bash
./scripts/release.sh <version>
```
