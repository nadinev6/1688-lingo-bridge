@echo off
setlocal enabledelayedexpansion

REM Color setup - simplified for Windows
set "BLUE=[34m"
set "GREEN=[32m"
set "YELLOW=[33m"
set "CYAN=[36m"
set "RESET=[0m"

if "%1"=="" goto help
if "%1"=="help" goto help
if "%1"=="check-prereqs" goto check-prereqs
if "%1"=="init" goto init
if "%1"=="setup" goto setup
if "%1"=="setup-python" goto setup-python
if "%1"=="setup-node" goto setup-node
if "%1"=="setup-go" goto setup-go
if "%1"=="lint" goto lint
if "%1"=="test" goto test
if "%1"=="clean" goto clean
echo Unknown command: %1
echo Run 'setup.bat help' for available commands
exit /b 1

:help
echo.
echo %BLUE%Makefile Template - Available Targets%RESET%
echo.
echo Quick Start (Recommended):
echo   setup.bat setup            - Auto-detect and setup everything
echo   setup.bat check-prereqs    - Check if required tools are installed
echo.
echo Initialization:
echo   setup.bat init             - Initialize project with pre-commit
echo.
echo Language Setup:
echo   setup.bat setup-python     - Setup Python environment (venv, pip)
echo   setup.bat setup-node       - Setup Node.js environment (node_modules)
echo   setup.bat setup-go         - Setup Go environment (dependencies)
echo.
echo Development:
echo   setup.bat lint             - Run linters (requires pre-commit hooks)
echo   setup.bat test             - Run tests
echo   setup.bat clean            - Clean temporary files and caches
echo.
echo Notes:
echo   - First time? Run 'setup.bat setup' - it does everything!
echo   - Use 'setup.bat help' to see this message anytime
echo.
exit /b 0

:check-prereqs
echo %BLUE%Checking prerequisites...%RESET%
echo.
where git >nul 2>&1 && (
    echo %GREEN%[OK] Git installed%RESET%
) || (
    echo %YELLOW%[X] Git not found - Install from https://git-scm.com%RESET%
)
where python >nul 2>&1 && (
    for /f "tokens=*" %%a in ('python --version 2^>^&1') do echo %GREEN%[OK] Python installed ^(%%a^)%RESET%
) || (
    echo %YELLOW%[X] Python not found - Install from https://python.org%RESET%
)
where pip >nul 2>&1 && (
    echo %GREEN%[OK] pip installed%RESET%
) || (
    echo %YELLOW%[X] pip not found - Install Python with pip%RESET%
)
where node >nul 2>&1 && (
    for /f "tokens=*" %%a in ('node --version 2^>^&1') do echo %CYAN%[i] Node.js installed ^(%%a^)%RESET%
) || (
    echo %CYAN%[i] Node.js not installed ^(optional^) - Install from https://nodejs.org%RESET%
)
where npm >nul 2>&1 && (
    echo %GREEN%[OK] npm installed%RESET%
) || (
    echo %CYAN%[i] npm not installed ^(optional^)%RESET%
)
where go >nul 2>&1 && (
    for /f "tokens=*" %%a in ('go version 2^>^&1') do echo %CYAN%[i] Go installed ^(%%a^)%RESET%
) || (
    echo %CYAN%[i] Go not installed ^(optional^) - Install from https://golang.org%RESET%
)
echo.
exit /b 0

:init
echo %BLUE%Installing pre-commit...%RESET%
where pip >nul 2>&1 || (
    echo %YELLOW%[X] pip not found. Please install Python and pip first:%RESET%
    echo   - Windows: Download from https://python.org
    exit /b 1
)
REM Install pre-commit if not already installed
python -m pip show pre-commit >nul 2>&1 || (
    echo Installing pre-commit package...
    pip install pre-commit
)
REM Install the git hooks
echo Installing pre-commit hooks...
python -m pre_commit install
if errorlevel 1 (
    echo %YELLOW%[X] Failed to install pre-commit hooks%RESET%
    exit /b 1
)
echo %GREEN%[OK] pre-commit installed and hooks configured%RESET%
echo.
echo %GREEN%   Project initialized with pre-commit!%RESET%
echo.
echo Your repository is now protected against:
echo   - API Keys ^& tokens
echo   - Database passwords
echo   - Private keys ^(SSH, PGP^)
echo   - OAuth credentials
echo.
exit /b 0

:setup
call :check-prereqs
echo.
echo %BLUE%AUTO-SETUP - Detecting and configuring...%RESET%
echo.
call :init
if errorlevel 1 exit /b 1

REM Detect project type
set "LANG=none"
if exist "requirements.txt" set "LANG=python"
if exist "setup.py" set "LANG=python"
if exist "pyproject.toml" set "LANG=python"
if exist "Pipfile" set "LANG=python"
if exist "package.json" set "LANG=node"
if exist "go.mod" set "LANG=go"
if exist "go.sum" set "LANG=go"

if "%LANG%"=="python" (
    echo.
    echo %BLUE%Python project detected - setting up...%RESET%
    call :setup-python
) else if "%LANG%"=="node" (
    echo.
    echo %BLUE%Node.js project detected - setting up...%RESET%
    call :setup-node
) else if "%LANG%"=="go" (
    echo.
    echo %BLUE%Go project detected - setting up...%RESET%
    call :setup-go
)

echo.
echo %GREEN%SETUP COMPLETE!%RESET%
echo.
echo You're ready to code securely!
echo.
exit /b 0

:setup-python
echo %BLUE%Setting up Python environment...%RESET%
where python >nul 2>&1 || (
    echo %YELLOW%[X] Python not found. Please install Python from https://python.org%RESET%
    exit /b 1
)
if not exist venv (
    python -m venv venv
    echo %GREEN%[OK] Virtual environment created%RESET%
) else (
    echo %CYAN%[i] Virtual environment already exists%RESET%
)
if exist "requirements.txt" (
    echo %BLUE%Installing Python dependencies from requirements.txt...%RESET%
    venv\Scripts\pip install -r requirements.txt
    if errorlevel 1 (
        echo %YELLOW%Note: Activate venv and run: pip install -r requirements.txt%RESET%
    ) else (
        echo %GREEN%[OK] Dependencies installed%RESET%
    )
)
echo.
echo Next steps:
echo   - Activate: venv\Scripts\activate
echo.
exit /b 0

:setup-node
echo %BLUE%Setting up Node.js environment...%RESET%
where npm >nul 2>&1 || (
    echo %YELLOW%[X] Node.js/npm not found. Please install Node.js from https://nodejs.org%RESET%
    exit /b 1
)
if exist "package.json" (
    npm install
    echo %GREEN%[OK] Node.js dependencies installed%RESET%
) else (
    echo %YELLOW%No package.json found - skipping npm install%RESET%
    echo %CYAN%Tip: Run 'npm init' to create a package.json%RESET%
)
exit /b 0

:setup-go
echo %BLUE%Setting up Go environment...%RESET%
where go >nul 2>&1 || (
    echo %YELLOW%[X] Go not found. Please install Go from https://golang.org%RESET%
    exit /b 1
)
if exist "go.mod" (
    go mod download
    echo %GREEN%[OK] Go dependencies downloaded%RESET%
) else (
    echo %YELLOW%No go.mod found - initializing new module%RESET%
    go mod init module
    echo %GREEN%[OK] Go module initialized%RESET%
)
exit /b 0

:lint
echo %BLUE%Running linters...%RESET%
python -m pre_commit run --all-files
echo %GREEN%[OK] Linting complete%RESET%
exit /b 0

:test
echo %BLUE%Running tests...%RESET%
echo %YELLOW%Note: Customize test command in setup.bat for your project%RESET%
echo Examples:
echo   - Python: pytest
echo   - Node.js: npm test
echo   - Go: go test ./...
exit /b 0

:clean
echo %BLUE%Cleaning temporary files...%RESET%
for /d /r . %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d" 2>nul
for /d /r . %%d in (.pytest_cache) do @if exist "%%d" rd /s /q "%%d" 2>nul
for /r . %%f in (*.pyc) do @if exist "%%f" del /q "%%f" 2>nul
del /s /q .DS_Store 2>nul
echo %GREEN%[OK] Cleanup complete%RESET%
exit /b 0
