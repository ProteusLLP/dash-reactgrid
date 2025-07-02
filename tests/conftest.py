"""
Test configuration and runner for DashReactGrid test suite.

This module provides configuration for running the comprehensive test suite
and includes utilities for test reporting and organization.
"""

import pytest
import sys
import os
from pathlib import Path

# Add the project root to Python path for imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


def pytest_configure(config):
    """Configure pytest with custom markers and settings."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line("markers", "integration: marks tests as integration tests")
    config.addinivalue_line("markers", "performance: marks tests as performance tests")
    config.addinivalue_line("markers", "edge_case: marks tests as edge case tests")


def pytest_collection_modifyitems(config, items):
    """Modify test collection to add automatic markers."""
    for item in items:
        # Mark slow tests
        if "large_dataset" in item.name or "performance" in item.name:
            item.add_marker(pytest.mark.slow)

        # Mark integration tests
        if "integration" in str(item.fspath):
            item.add_marker(pytest.mark.integration)

        # Mark performance tests
        if "performance" in str(item.fspath):
            item.add_marker(pytest.mark.performance)

        # Mark edge case tests
        if "edge" in str(item.fspath):
            item.add_marker(pytest.mark.edge_case)


@pytest.fixture(scope="session")
def test_data_dir():
    """Provide path to test data directory."""
    return Path(__file__).parent / "test_data"


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Set up test environment before running tests."""
    # Ensure dash_reactgrid module can be imported
    try:
        import dash_reactgrid

        print(f"✓ dash_reactgrid module loaded from: {dash_reactgrid.__file__}")
    except ImportError as e:
        print(f"✗ Failed to import dash_reactgrid: {e}")
        pytest.exit("Cannot import dash_reactgrid module", 1)

    # Check if required dependencies are available
    required_modules = ["dash", "selenium", "pytest"]
    missing_modules = []

    for module in required_modules:
        try:
            __import__(module)
        except ImportError:
            missing_modules.append(module)

    if missing_modules:
        print(f"✗ Missing required modules: {missing_modules}")
        pytest.exit(f"Missing dependencies: {missing_modules}", 1)

    print("✓ Test environment setup complete")
    yield
    print("✓ Test environment cleanup complete")


def run_basic_tests():
    """Run basic functionality tests."""
    return pytest.main(["tests/test_basic_functionality.py", "-v", "--tb=short"])


def run_dropdown_tests():
    """Run dropdown functionality tests."""
    return pytest.main(["tests/test_dropdown_functionality.py", "-v", "--tb=short"])


def run_performance_tests():
    """Run performance tests."""
    return pytest.main(
        [
            "tests/test_performance.py",
            "-v",
            "--tb=short",
            "-m",
            "not slow",  # Skip slow tests by default
        ]
    )


def run_paste_tests():
    """Run paste functionality tests."""
    return pytest.main(["tests/test_paste_functionality.py", "-v", "--tb=short"])


def run_edge_case_tests():
    """Run edge case tests."""
    return pytest.main(["tests/test_edge_cases.py", "-v", "--tb=short"])


def run_integration_tests():
    """Run integration tests."""
    return pytest.main(["tests/test_integration.py", "-v", "--tb=short"])


def run_all_tests():
    """Run the complete test suite."""
    return pytest.main(
        [
            "tests/",
            "-v",
            "--tb=short",
            "--strict-markers",
            "-m",
            "not slow",  # Skip slow tests by default
        ]
    )


def run_all_tests_including_slow():
    """Run the complete test suite including slow tests."""
    return pytest.main(["tests/", "-v", "--tb=short", "--strict-markers"])


def run_tests_with_coverage():
    """Run tests with coverage reporting."""
    return pytest.main(
        [
            "tests/",
            "-v",
            "--tb=short",
            "--cov=dash_reactgrid",
            "--cov-report=html",
            "--cov-report=term-missing",
            "-m",
            "not slow",
        ]
    )


def run_specific_test_pattern(pattern):
    """Run tests matching a specific pattern."""
    return pytest.main(["tests/", "-v", "--tb=short", "-k", pattern])


if __name__ == "__main__":
    """Main entry point for running tests."""
    import argparse

    parser = argparse.ArgumentParser(description="Run DashReactGrid test suite")
    parser.add_argument(
        "--suite",
        choices=[
            "all",
            "basic",
            "dropdown",
            "performance",
            "paste",
            "edge",
            "integration",
            "slow",
        ],
        default="all",
        help="Test suite to run",
    )
    parser.add_argument(
        "--coverage", action="store_true", help="Run with coverage reporting"
    )
    parser.add_argument("--pattern", help="Run tests matching pattern")

    args = parser.parse_args()

    if args.pattern:
        exit_code = run_specific_test_pattern(args.pattern)
    elif args.coverage:
        exit_code = run_tests_with_coverage()
    elif args.suite == "basic":
        exit_code = run_basic_tests()
    elif args.suite == "dropdown":
        exit_code = run_dropdown_tests()
    elif args.suite == "performance":
        exit_code = run_performance_tests()
    elif args.suite == "paste":
        exit_code = run_paste_tests()
    elif args.suite == "edge":
        exit_code = run_edge_case_tests()
    elif args.suite == "integration":
        exit_code = run_integration_tests()
    elif args.suite == "slow":
        exit_code = run_all_tests_including_slow()
    else:  # "all"
        exit_code = run_all_tests()

    sys.exit(exit_code)
