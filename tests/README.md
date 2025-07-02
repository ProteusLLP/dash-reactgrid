# DashReactGrid Test Suite

This directory contains a comprehensive automated test suite for the DashReactGrid component using pytest, dash.testing, and selenium.

## Test Files Overview

### Core Test Files

- **`test_basic_functionality.py`** - Tests basic grid functionality including rendering, cell editing, data validation, and error handling
- **`test_dropdown_functionality.py`** - Comprehensive tests for dropdown cell interactions, selection, and state management  
- **`test_performance.py`** - Performance tests for large datasets, virtual scrolling, and optimization features
- **`test_paste_functionality.py`** - Tests for copy/paste operations, data boundary handling, and keyboard interactions
- **`test_edge_cases.py`** - Edge case scenarios, error handling, robustness testing, and boundary conditions
- **`test_integration.py`** - Integration tests with Dash callbacks, multi-component interactions, and state management

### Original Test Files

- **`test_dash_reactgrid.py`** - Original basic test file (kept for compatibility)
- **`test_usage.py`** - Usage example tests

### Configuration Files

- **`conftest.py`** - Pytest configuration and test runner utilities
- **`requirements.txt`** - Test dependencies
- **`pytest.ini`** - Pytest configuration settings
- **`run_tests.py`** - Comprehensive test runner script

## Test Categories

The test suite is organized with pytest markers:

- **`slow`** - Performance tests that may take longer to run
- **`integration`** - Integration tests with multiple components
- **`performance`** - Performance and optimization tests
- **`edge_case`** - Edge cases and error handling tests
- **`dropdown`** - Dropdown-specific functionality tests
- **`paste`** - Copy/paste functionality tests

## Running Tests

### Quick Start

```bash
# Install test dependencies
pip install -r tests/requirements.txt

# Run tests quickly (headless, parallel, no slow tests) - RECOMMENDED
python run_tests.py --fast

# Run all tests (excluding slow ones)
python run_tests.py

# Run all tests including slow performance tests
python run_tests.py --all
```

### Using pytest directly

```bash
# Run all tests
pytest tests/

# Run all tests in headless mode (faster)
DASH_TEST_HEADLESS=true pytest tests/

# Run tests in parallel (faster)
pytest tests/ -n auto

# Run tests excluding slow ones (faster)
pytest tests/ -m "not slow"

# Combine for fastest execution
DASH_TEST_HEADLESS=true pytest tests/ -n auto -m "not slow"

# Run specific test file
pytest tests/test_basic_functionality.py

# Run tests with specific marker
pytest tests/ -m "dropdown"

# Run with coverage
pytest tests/ --cov=dash_reactgrid --cov-report=html
```

### Using the test runner script

```bash
# Run tests quickly (RECOMMENDED for development)
python run_tests.py --fast

# Run tests in headless mode
python run_tests.py --headless

# Run specific test suite
python run_tests.py --suite basic
python run_tests.py --suite dropdown
python run_tests.py --suite performance
python run_tests.py --suite paste
python run_tests.py --suite edge
python run_tests.py --suite integration

# Run with coverage reporting
python run_tests.py --coverage

# Run tests matching a pattern
python run_tests.py --pattern "dropdown"

# Run tests in parallel
python run_tests.py --parallel

# Quick smoke test
python run_tests.py --smoke

# Generate HTML report
python run_tests.py --report
```

## Test Structure

Each test file follows a consistent structure:

```python
# Test fixtures for different app configurations
@pytest.fixture
def app_fixture():
    # Setup test app
    pass

# Test classes organized by functionality
class TestFeatureCategory:
    def test_specific_feature(self, dash_duo, app_fixture):
        # Test implementation
        pass
```

## Key Test Features

### 1. Basic Functionality Tests
- Grid rendering and initialization
- Cell editing for all cell types (text, number, checkbox, date, dropdown)
- Data validation and error handling
- Grid properties and configuration

### 2. Dropdown Functionality Tests
- Dropdown cell rendering and interaction
- Option selection and data updates
- Multiple dropdown columns
- Performance with large option lists
- Keyboard navigation and accessibility

### 3. Performance Tests
- Large dataset handling (1000+ rows)
- Virtual scrolling efficiency
- Memory usage stability
- Rapid data updates
- Mixed cell types performance

### 4. Copy/Paste Tests
- Simple paste operations
- Boundary validation (paste overflow)
- Cross-cell type pasting
- Large data paste operations
- Keyboard shortcuts (Ctrl+C, Ctrl+V)

### 5. Edge Cases Tests
- Empty grid handling
- Special characters in data
- Null/undefined values
- Browser zoom compatibility
- Window resize handling
- Extremely large numbers

### 6. Integration Tests
- Multi-component Dash apps
- Callback interactions
- State persistence
- Error recovery
- Complex data flows

## Test Environment

The test suite requires:

- **Python 3.7+**
- **dash[dev,testing]** - Dash framework with testing utilities
- **pytest** - Testing framework
- **selenium** - Web browser automation
- **pytest-cov** - Coverage reporting
- **pytest-html** - HTML test reports

## Performance Optimization

### Fastest Test Execution

For the fastest test execution during development:

```bash
# Recommended: Fast mode (headless + parallel + no slow tests)
python run_tests.py --fast

# Alternative: Manual combination
DASH_TEST_HEADLESS=true pytest tests/ -n auto -m "not slow"
```

### Speed Optimization Techniques

1. **Headless Mode**: Tests run ~2x faster without GUI
2. **Parallel Execution**: Use all CPU cores with `-n auto`
3. **Skip Slow Tests**: Use `-m "not slow"` to exclude performance tests
4. **Target Specific Tests**: Run only the tests you're working on

### Environment Variables

- `DASH_TEST_HEADLESS=true` - Run browsers in headless mode
- `DASH_TEST_PROCESSES=1` - Control number of browser processes

## Browser Testing

Tests run in a headless browser environment using selenium. The default browser is Chrome, but this can be configured through dash.testing.

## Continuous Integration

The test suite is designed to work with CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: |
    pip install -r tests/requirements.txt
    python run_tests.py --coverage
```

## Writing New Tests

### Test Naming Convention
- Test files: `test_<feature>.py`
- Test classes: `Test<FeatureCategory>`
- Test methods: `test_<specific_functionality>`

### Best Practices
1. Use descriptive test names
2. Include docstrings explaining test purpose
3. Use appropriate fixtures for test setup
4. Add markers for test categorization
5. Handle browser timing with appropriate waits
6. Clean up resources in teardown

### Example Test

```python
def test_new_feature(self, dash_duo, basic_app):
    """Test description of what this test validates."""
    dash_duo.start_server(basic_app)
    dash_duo.wait_for_element(f"#{GRID_ID}", timeout=10)
    
    # Test implementation
    element = dash_duo.find_element("selector")
    element.click()
    
    # Assertions
    assert expected_condition
```

## Troubleshooting

### Common Issues

1. **Selenium WebDriver Issues**
   ```bash
   # Update Chrome/ChromeDriver
   pip install --upgrade selenium
   ```

2. **Timing Issues**
   - Increase wait times for slow systems
   - Use explicit waits instead of sleep()

3. **Port Conflicts**
   - Tests automatically use different ports
   - Check for processes using port ranges 58000+

4. **Memory Issues with Large Tests**
   - Run tests with `--maxfail=1` to stop on first failure
   - Use `pytest-xdist` for parallel execution

### Debug Mode

Run tests with verbose output:
```bash
pytest tests/ -v -s --tb=long
```

## Coverage Reports

Coverage reports are generated in multiple formats:
- **Terminal**: Summary in console output
- **HTML**: `htmlcov/index.html` - Detailed interactive report
- **XML**: `coverage.xml` - Machine-readable format for CI

## Performance Monitoring

Performance tests include timing assertions and memory usage checks. Monitor these metrics to catch performance regressions.

## Contributing

When adding new tests:
1. Follow the existing file structure
2. Add appropriate markers
3. Update this README if needed
4. Ensure tests pass in isolation and as part of the suite
