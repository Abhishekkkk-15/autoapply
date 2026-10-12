#!/usr/bin/env bash
# ==============================================================================
# AutoApply Installation & Setup Script for Linux, macOS & WSL
# ==============================================================================
set -e

# Terminal colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

SKIP_PLAYWRIGHT=false
for arg in "$@"; do
    case $arg in
        --skip-playwright)
            SKIP_PLAYWRIGHT=true
            shift
            ;;
    esac
done

REPO_URL="https://github.com/Abhishekkkk-15/autoapply.git"
TARBALL_URL="https://github.com/Abhishekkkk-15/autoapply/archive/refs/heads/main.tar.gz"
CLONED_NEW=false

# 0. Locate or clone project directory
if [ -f "pyproject.toml" ] && [ -d "job_agent" ]; then
    PROJECT_DIR="$PWD"
elif [ -n "${BASH_SOURCE[0]}" ] && [ -f "${BASH_SOURCE[0]}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/pyproject.toml" ]; then
    PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$PROJECT_DIR"
else
    # Script is run via web pipe (curl | bash) or outside an existing clone
    echo -e "${YELLOW}[0/5] Setting up AutoApply repository...${NC}"
    TARGET_DIR="autoapply"

    if [ -d "$TARGET_DIR" ] && [ -f "$TARGET_DIR/pyproject.toml" ]; then
        echo -e "  Found existing '$TARGET_DIR' directory. Using it..."
        cd "$TARGET_DIR"
        PROJECT_DIR="$PWD"
    else
        echo -e "  Fetching repository into './$TARGET_DIR'..."
        if command -v git >/dev/null 2>&1; then
            echo -e "  Cloning from $REPO_URL..."
            git clone "$REPO_URL" "$TARGET_DIR"
        elif command -v curl >/dev/null 2>&1; then
            echo -e "  git not found. Downloading archive via curl..."
            mkdir -p "$TARGET_DIR"
            curl -fsSL "$TARBALL_URL" | tar -xz -C "$TARGET_DIR" --strip-components=1
        elif command -v wget >/dev/null 2>&1; then
            echo -e "  git not found. Downloading archive via wget..."
            mkdir -p "$TARGET_DIR"
            wget -qO- "$TARBALL_URL" | tar -xz -C "$TARGET_DIR" --strip-components=1
        else
            echo -e "${RED}[ERROR] Neither git, curl, nor wget is installed. Please install git or curl and re-run.${NC}"
            exit 1
        fi
        cd "$TARGET_DIR"
        PROJECT_DIR="$PWD"
        CLONED_NEW=true
    fi
fi

echo -e "${CYAN}========================================================================${NC}"
echo -e "${CYAN}     _         _             _                   _       ${NC}"
echo -e "${CYAN}    / \  _   _| |_ ___      / \   _ __  _ __   | |_   _ ${NC}"
echo -e "${CYAN}   / _ \| | | | __/ _ \    / _ \ | '_ \| '_ \  | | | | |${NC}"
echo -e "${CYAN}  / ___ \ |_| | || (_) |  / ___ \| |_) | |_) | | | |_| |${NC}"
echo -e "${CYAN} /_/   \_\__,_|\__\___/  /_/   \_\ .__/| .__/  |_|\__, |${NC}"
echo -e "${CYAN}                                 |_|   |_|        |___/ ${NC}"
echo -e "${CYAN}      Autonomous AI Job Application Agent Setup${NC}"
echo -e "${CYAN}========================================================================${NC}"

# 1. Check or install uv
echo -e "\n${YELLOW}[1/5] Checking package manager (uv)...${NC}"

if ! command -v uv >/dev/null 2>&1; then
    if [ -x "$HOME/.local/bin/uv" ]; then
        export PATH="$HOME/.local/bin:$PATH"
    elif [ -x "$HOME/.cargo/bin/uv" ]; then
        export PATH="$HOME/.cargo/bin:$PATH"
    fi
fi

if ! command -v uv >/dev/null 2>&1; then
    echo -e "  uv not found in PATH. Downloading and installing uv via Astral..."
    if command -v curl >/dev/null 2>&1; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- https://astral.sh/uv/install.sh | sh
    else
        echo -e "  curl or wget not found. Trying pip fallback..."
        pip install --upgrade uv || pip3 install --upgrade uv
    fi

    if [ -x "$HOME/.local/bin/uv" ]; then
        export PATH="$HOME/.local/bin:$PATH"
    elif [ -x "$HOME/.cargo/bin/uv" ]; then
        export PATH="$HOME/.cargo/bin:$PATH"
    fi
fi

if ! command -v uv >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Failed to install or locate 'uv'. Please install it from https://docs.astral.sh/uv/ and re-run.${NC}"
    exit 1
fi

UV_VERSION=$(uv --version)
echo -e "  ${GREEN}[OK] Found $UV_VERSION${NC}"

# 2. Sync dependencies
echo -e "\n${YELLOW}[2/5] Installing dependencies with 'uv sync'...${NC}"
uv sync
echo -e "  ${GREEN}[OK] Python virtual environment and dependencies synchronized.${NC}"

# 3. Install Playwright Chromium browser
echo -e "\n${YELLOW}[3/5] Checking browser engine...${NC}"
if [ "$SKIP_PLAYWRIGHT" = true ]; then
    echo -e "  ${GRAY}[SKIPPED] Playwright Chromium installation skipped by user flag.${NC}"
else
    echo -e "  Installing Chromium browser for automation..."
    if uv run playwright install chromium; then
        echo -e "  ${GREEN}[OK] Chromium installed successfully.${NC}"
    else
        echo -e "  ${YELLOW}[WARN] Playwright install encountered a warning. You can re-run manually with 'uv run playwright install chromium'.${NC}"
    fi
fi

# 4. Prepare local directories and config
echo -e "\n${YELLOW}[4/5] Setting up local directories and environment...${NC}"
DATA_DIR="$PROJECT_DIR/job_agent/data"
mkdir -p "$DATA_DIR"
echo -e "  ${GREEN}[OK] Data directory ready: $DATA_DIR${NC}"

ENV_FILE="$PROJECT_DIR/job_agent/.env"
ENV_EXAMPLE="$PROJECT_DIR/job_agent/.env.example"
ROOT_ENV="$PROJECT_DIR/.env"

if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo -e "  ${GREEN}[OK] Created 'job_agent/.env' from template.${NC}"
else
    echo -e "  ${GREEN}[OK] 'job_agent/.env' already present.${NC}"
fi

if [ ! -f "$ROOT_ENV" ] && [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ROOT_ENV"
    echo -e "  ${GREEN}[OK] Created root '.env' from template.${NC}"
fi

# 5. Verify CLI executable
echo -e "\n${YELLOW}[5/5] Verifying AutoApply CLI...${NC}"
if uv run autoapply --help >/dev/null 2>&1; then
    echo -e "  ${GREEN}[OK] 'autoapply' CLI successfully registered and operational!${NC}"
else
    echo -e "${RED}[ERROR] AutoApply CLI verification failed.${NC}"
    exit 1
fi

echo -e "\n${GREEN}========================================================================${NC}"
echo -e "${GREEN}[SUCCESS] AutoApply Installation Complete!${NC}"
echo -e "${GREEN}========================================================================${NC}"
echo -e ""
echo -e "Next Steps:"
if [ "$CLONED_NEW" = true ]; then
    echo -e "  👉 First, enter the project directory:"
    echo -e "     ${CYAN}cd autoapply${NC}"
    echo -e ""
fi
echo -e "  1. Add your AI API key:"
echo -e "     Edit 'job_agent/.env' (or '.env') and provide your BROWSER_USE_API_KEY or OPENAI_API_KEY."
echo -e ""
echo -e "  2. Add your resume:"
echo -e "     Place your resume at 'job_agent/data/resume.pdf' or 'job_agent/data/resume.txt'."
echo -e ""
echo -e "  3. Run the interactive onboarding wizard:"
echo -e "     ${CYAN}uv run autoapply setup${NC}"
echo -e ""
echo -e "  4. Run system diagnostics:"
echo -e "     ${CYAN}uv run autoapply doctor${NC}"
echo -e ""
echo -e "  5. Test autonomous application in safe dry-run mode:"
echo -e "     ${CYAN}uv run autoapply auto --dry-run${NC}"
echo -e ""
echo -e "${GREEN}========================================================================${NC}"

