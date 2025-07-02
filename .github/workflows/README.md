# GitHub Actions Workflows

This directory contains automated CI/CD workflows for the DashReactGrid project.

## Workflows Overview

### 1. `test.yml` - Main Test Suite
**Triggered on:** Push to main/develop, Pull Requests, Daily schedule

**Features:**
- Cross-platform testing (Ubuntu, Windows, macOS)
- Multiple Python versions (3.8, 3.9, 3.10, 3.11)
- Fast tests with headless browsers
- Coverage reporting
- Performance and integration tests
- Artifact uploads

**Jobs:**
- **test**: Main test matrix across OS and Python versions
- **performance-tests**: Dedicated performance testing
- **integration-tests**: Integration test suite
- **smoke-tests**: Quick validation tests
- **compatibility-tests**: Browser compatibility checks
- **test-summary**: Aggregated results summary

### 2. `pr-test.yml` - Pull Request Tests
**Triggered on:** Pull Requests

**Features:**
- Fast execution for quick feedback
- Code quality checks (linting, formatting)
- Security scanning
- Lightweight test suite

**Jobs:**
- **quick-test**: Fast test execution
- **lint-check**: Code quality validation
- **security-check**: Security vulnerability scanning

### 3. `release-test.yml` - Release Testing
**Triggered on:** Releases, Manual dispatch

**Features:**
- Comprehensive test suite including slow tests
- Stress testing with system monitoring
- Browser compatibility matrix
- Package build and deployment checks

**Jobs:**
- **comprehensive-test**: Full test suite across platforms
- **stress-test**: Performance stress testing
- **browser-matrix**: Multi-browser compatibility
- **deployment-check**: Package build validation
- **release-summary**: Release readiness summary

## Environment Variables

The workflows use these environment variables for optimization:

- `DASH_TEST_HEADLESS=true` - Run browsers in headless mode
- `DASH_TEST_PROCESSES=1` - Control browser process count

## Speed Optimizations

### Fast Test Execution
All workflows are optimized for speed:

1. **Headless Mode**: All browser tests run headless (~2x faster)
2. **Parallel Execution**: Tests run in parallel using pytest-xdist
3. **Smart Caching**: Dependencies are cached between runs
4. **Selective Testing**: PR tests exclude slow performance tests
5. **Matrix Optimization**: Strategic exclusion of redundant combinations

### Caching Strategy
- **pip dependencies**: Cached by OS, Python version, and requirements hash
- **Browser binaries**: System-level installation with caching
- **Test artifacts**: Preserved for debugging and analysis

## Test Categories

Tests are organized with pytest markers:

- `slow` - Performance tests (excluded in fast modes)
- `integration` - Multi-component tests
- `performance` - Performance benchmarks
- `edge_case` - Edge cases and error handling
- `dropdown` - Dropdown-specific tests
- `paste` - Copy/paste functionality

## Artifact Management

### Uploaded Artifacts
- **Test Reports**: HTML reports with detailed results
- **Coverage Data**: HTML and XML coverage reports
- **Performance Metrics**: Timing and resource usage data
- **Security Reports**: Vulnerability scan results
- **Build Artifacts**: Package distribution files

### Retention Policy
- Test artifacts: 30 days
- Coverage reports: 90 days
- Release artifacts: 1 year

## Workflow Triggers

### Automatic Triggers
- **Push to main/develop**: Full test suite
- **Pull Requests**: Fast tests + quality checks
- **Releases**: Comprehensive testing
- **Daily Schedule**: Maintenance testing (2 AM UTC)

### Manual Triggers
- `release-test.yml` supports manual dispatch with test type selection
- All workflows can be triggered manually from GitHub Actions UI

## Performance Monitoring

### Test Execution Times
- **Fast tests**: ~2-5 minutes
- **Full test suite**: ~10-15 minutes
- **Performance tests**: ~5-10 minutes
- **Comprehensive suite**: ~20-30 minutes

### Resource Usage
- **Memory**: Monitored during stress tests
- **CPU**: Multi-core utilization with parallel execution
- **Browser Resources**: Headless mode minimizes overhead

## Failure Handling

### Strategies
- **Fail-fast**: Disabled for test matrices to see all results
- **Continue-on-error**: Used for non-critical checks
- **Retry Logic**: Built into individual test commands

### Debugging
- **Verbose Output**: All tests run with detailed logging
- **Artifact Preservation**: Failed test results are uploaded
- **System Information**: Environment details captured

## Security

### Dependency Scanning
- **Safety**: Check for known vulnerabilities
- **Bandit**: Static security analysis
- **Regular Updates**: Automated dependency updates

### Environment Security
- **Minimal Permissions**: Workflows use least-privilege access
- **Secret Management**: No secrets stored in repository
- **Isolated Execution**: Each job runs in fresh environment

## Contributing

When adding new tests or modifying workflows:

1. **Test Locally**: Use `python run_tests.py --fast` for quick validation
2. **Update Markers**: Add appropriate pytest markers
3. **Consider Speed**: Avoid adding slow tests to fast execution paths
4. **Document Changes**: Update this README for significant modifications

## Monitoring and Alerts

### Success Metrics
- **Test Pass Rate**: Target >95% success rate
- **Execution Time**: Monitor for performance regressions
- **Coverage**: Maintain >80% code coverage

### Alerting
- **Failed Builds**: Automatic notifications to maintainers
- **Security Issues**: Immediate alerts for vulnerabilities
- **Performance**: Warnings for execution time increases

## Local Development

To run the same tests locally:

```bash
# Quick tests (matches PR workflow)
python run_tests.py --fast

# Full suite (matches main workflow)
python run_tests.py --all --coverage

# Performance tests
python run_tests.py --suite performance

# Release validation
python run_tests.py --all --coverage --report
```

## Troubleshooting

### Common Issues
1. **Browser Dependencies**: Ensure ChromeDriver is available
2. **Port Conflicts**: Tests use dynamic port allocation
3. **Memory Issues**: Use `--maxfail=1` for large test suites
4. **Timing Issues**: Increase timeouts for slow environments

### Environment Variables
```bash
# For debugging
export DASH_TEST_HEADLESS=false  # Show browser UI
export DASH_TEST_PROCESSES=4     # Increase parallelism
```
