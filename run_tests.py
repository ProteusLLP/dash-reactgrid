#!/usr/bin/env python3
"""
Comprehensive test runner for DashReactGrid test suite.

This script provides multiple ways to run the test suite with different
configurations and reporting options.

Usage:
    python run_tests.py                    # Run all tests (excluding slow)
    python run_tests.py --all              # Run all tests including slow
    python run_tests.py --suite basic      # Run specific test suite
    python run_tests.py --coverage         # Run with coverage
    python run_tests.py --pattern dropdown # Run tests matching pattern
    python run_tests.py --parallel         # Run tests in parallel
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path


def run_command(cmd, description=""):
    """Run a command and return the exit code."""
    if description:
        print(f"\n🔄 {description}")
    
    print(f"Running: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, check=False)
        return result.returncode
    except KeyboardInterrupt:
        print("\n❌ Tests interrupted by user")
        return 1
    except Exception as e:
        print(f"❌ Error running command: {e}")
        return 1


def check_dependencies():
    """Check if all required dependencies are installed."""
    print("🔍 Checking dependencies...")
    
    required_packages = [
        "dash", "pytest", "selenium", "dash_reactgrid"
    ]
    
    missing_packages = []
    for package in required_packages:
        try:
            __import__(package.replace("-", "_"))
            print(f"  ✓ {package}")
        except ImportError:
            print(f"  ❌ {package}")
            missing_packages.append(package)
    
    if missing_packages:
        print(f"\n❌ Missing packages: {missing_packages}")
        print("Please install them with:")
        print("  pip install -r tests/requirements.txt")
        return False
    
    print("✅ All dependencies satisfied")
    return True


def run_basic_tests(parallel=False):
    """Run basic functionality tests."""
    cmd = ["python", "-m", "pytest", "tests/test_basic_functionality.py", "-v"]
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, "Running basic functionality tests")


def run_dropdown_tests(parallel=False):
    """Run dropdown functionality tests."""
    cmd = ["python", "-m", "pytest", "tests/test_dropdown_functionality.py", "-v"]
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, "Running dropdown functionality tests")


def run_performance_tests(include_slow=False, parallel=False):
    """Run performance tests."""
    cmd = ["python", "-m", "pytest", "tests/test_performance.py", "-v"]
    if not include_slow:
        cmd.extend(["-m", "not slow"])
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, "Running performance tests")


def run_paste_tests(parallel=False):
    """Run paste functionality tests."""
    cmd = ["python", "-m", "pytest", "tests/test_paste_functionality.py", "-v"]
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, "Running paste functionality tests")


def run_edge_case_tests(parallel=False):
    """Run edge case tests."""
    cmd = ["python", "-m", "pytest", "tests/test_edge_cases.py", "-v"]
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, "Running edge case tests")


def run_integration_tests(parallel=False):
    """Run integration tests."""
    cmd = ["python", "-m", "pytest", "tests/test_integration.py", "-v"]
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, "Running integration tests")


def run_all_tests(include_slow=False, parallel=False):
    """Run all tests."""
    cmd = ["python", "-m", "pytest", "tests/", "-v"]
    if not include_slow:
        cmd.extend(["-m", "not slow"])
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, "Running complete test suite")


def run_with_coverage(include_slow=False, parallel=False):
    """Run tests with coverage reporting."""
    cmd = [
        "python", "-m", "pytest", "tests/",
        "--cov=dash_reactgrid",
        "--cov-report=html:htmlcov",
        "--cov-report=term-missing",
        "--cov-report=xml",
        "-v"
    ]
    if not include_slow:
        cmd.extend(["-m", "not slow"])
    if parallel:
        cmd.extend(["-n", "auto"])
    
    exit_code = run_command(cmd, "Running tests with coverage")
    
    if exit_code == 0:
        print("\n📊 Coverage report generated:")
        print("  - HTML: htmlcov/index.html")
        print("  - XML: coverage.xml")
    
    return exit_code


def run_pattern_tests(pattern, parallel=False):
    """Run tests matching a pattern."""
    cmd = ["python", "-m", "pytest", "tests/", "-v", "-k", pattern]
    if parallel:
        cmd.extend(["-n", "auto"])
    return run_command(cmd, f"Running tests matching pattern: {pattern}")


def run_fast_tests():
    """Run tests quickly (headless + parallel + no slow tests)."""
    # Set environment variables for fast execution
    os.environ["DASH_TEST_HEADLESS"] = "true"
    os.environ["DASH_TEST_PROCESSES"] = "1"
    
    cmd = [
        "python", "-m", "pytest", "tests/",
        "-v",
        "-m", "not slow",
        "-n", "auto",
        "--tb=short"
    ]
    return run_command(cmd, "Running fast tests (headless + parallel + no slow tests)")


def run_headless_tests(include_slow=False, parallel=False):
    """Run tests in headless mode."""
    # Set environment variables for headless mode
    os.environ["DASH_TEST_HEADLESS"] = "true"
    os.environ["DASH_TEST_PROCESSES"] = "1"
    
    cmd = ["python", "-m", "pytest", "tests/", "-v"]
    if not include_slow:
        cmd.extend(["-m", "not slow"])
    if parallel:
        cmd.extend(["-n", "auto"])
    
    return run_command(cmd, "Running tests in headless mode")


def run_smoke_tests():
    """Run a minimal smoke test to check basic functionality."""
    # Set environment variables for fast execution
    os.environ["DASH_TEST_HEADLESS"] = "true"
    os.environ["DASH_TEST_PROCESSES"] = "1"
    
    cmd = [
        "python", "-m", "pytest",
        "tests/test_basic_functionality.py::TestBasicFunctionality::test_grid_renders",
        "tests/test_dropdown_functionality.py::TestDropdownFunctionality::test_dropdown_cell_renders",
        "-v",
        "--tb=short"
    ]
    return run_command(cmd, "Running smoke tests (basic functionality check)")


def generate_test_report():
    """Generate a comprehensive test report."""
    cmd = [
        "python", "-m", "pytest", "tests/",
        "--html=test_report.html",
        "--self-contained-html",
        "-v",
        "-m", "not slow"
    ]
    
    exit_code = run_command(cmd, "Generating test report")
    
    if exit_code == 0:
        print("\n📋 Test report generated: test_report.html")
    
    return exit_code


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Comprehensive test runner for DashReactGrid",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_tests.py                     # Run all tests (excluding slow)
  python run_tests.py --fast              # Run tests quickly (RECOMMENDED)
  python run_tests.py --headless          # Run tests in headless mode
  python run_tests.py --all               # Run all tests including slow
  python run_tests.py --suite basic       # Run basic functionality tests
  python run_tests.py --coverage          # Run with coverage reporting
  python run_tests.py --pattern dropdown  # Run dropdown-related tests
  python run_tests.py --smoke             # Quick smoke test
  python run_tests.py --report            # Generate HTML report
  python run_tests.py --parallel          # Run tests in parallel
        """
    )
    
    parser.add_argument(
        "--suite",
        choices=[
            "basic", "dropdown", "performance", "paste", 
            "edge", "integration", "all"
        ],
        help="Specific test suite to run"
    )
    
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all tests including slow ones"
    )
    
    parser.add_argument(
        "--coverage",
        action="store_true",
        help="Run tests with coverage reporting"
    )
    
    parser.add_argument(
        "--pattern",
        help="Run tests matching this pattern"
    )
    
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Run quick smoke test"
    )
    
    parser.add_argument(
        "--report",
        action="store_true",
        help="Generate HTML test report"
    )
    
    parser.add_argument(
        "--parallel",
        action="store_true",
        help="Run tests in parallel (requires pytest-xdist)"
    )
    
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Run tests in fast mode (headless, parallel, no slow tests)"
    )
    
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run tests in headless browser mode"
    )
    
    parser.add_argument(
        "--skip-deps",
        action="store_true",
        help="Skip dependency check"
    )
    
    args = parser.parse_args()
    
    # Check dependencies unless skipped
    if not args.skip_deps and not check_dependencies():
        return 1
    
    # Determine what to run
    if args.smoke:
        exit_code = run_smoke_tests()
    elif args.report:
        exit_code = generate_test_report()
    elif args.fast:
        exit_code = run_fast_tests()
    elif args.headless:
        exit_code = run_headless_tests()
    elif args.coverage:
        exit_code = run_with_coverage(args.all, args.parallel)
    elif args.pattern:
        exit_code = run_pattern_tests(args.pattern, args.parallel)
    elif args.suite == "basic":
        exit_code = run_basic_tests(args.parallel)
    elif args.suite == "dropdown":
        exit_code = run_dropdown_tests(args.parallel)
    elif args.suite == "performance":
        exit_code = run_performance_tests(args.all, args.parallel)
    elif args.suite == "edge":
        exit_code = run_edge_case_tests(args.parallel)
    elif args.suite == "integration":
        exit_code = run_integration_tests(args.parallel)
    else:  # Default or --suite all
        exit_code = run_all_tests(args.all, args.parallel)
    
    # Print summary
    if exit_code == 0:
        print("\n✅ All tests passed!")
    else:
        print(f"\n❌ Tests failed with exit code: {exit_code}")
    
    return exit_code


if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n❌ Interrupted by user")
        sys.exit(1)
