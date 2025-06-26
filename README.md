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

#### Render Documents and Store Outputs

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
          outputs: "*.pdf"
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
| `outputs`           | Path pattern for files to upload as artifacts                | No       | -         |
| `outputs-name`      | Name for the uploaded artifact                               | No       | `outputs` |
| `cache`             | Whether to cache the .stencila folder between runs           | No       | `true`    |
| `working-directory` | Working directory to run Stencila commands                   | No       | `.`       |

## Outputs

| Output      | Description                                    |
| ----------- | ---------------------------------------------- |
| `version`   | The version of Stencila CLI that was installed |
| `exit-code` | Exit code from the Stencila command            |

## Advanced Usage

### Storing outputs

After successfully rendering documents, you can automatically upload the output files as GitHub Actions artifacts:

```yaml
- uses: stencila/action@v1
  with:
    render: "report.smd report.docx"
    outputs: "*.docx"
```

This is useful for:

- Preserving rendered documents (PDFs, HTML, etc.) from CI runs
- Sharing outputs with team members
- Creating downloadable assets for releases

You can use glob patterns to match multiple files:

```yaml
- uses: stencila/action@v1
  with:
    render: "**/*.smd"
    outputs: |
      **/*.pdf
      **/*.html
      !**/temp.*
```


### Custom Working Directory

Run commands in a specific directory:

```yaml
- uses: stencila/action@v1
  with:
    lint: "report.smd"
    working-directory: ./docs
```

### Specific Version

Install a specific version of Stencila CLI:

```yaml
- uses: stencila/action@v1
  with:
    version: 2.0.0
    command: lint
    args: report.smd
```

### Caching

By default, this action caches the `.stencila` folder between runs to speed up subsequent executions. The cache is keyed by operating system, `stencila` version & Git commit SHA.

To disable caching:

```yaml
- uses: stencila/action@v1
  with:
    execute: "report.smd"
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
