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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "pyproject.toml" ] || [ ! -d "job_agent" ]; then
    echo -e "${RED}[ERROR] Please run this script from the root of the autoapply repository.${NC}"
    exit 1
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
DATA_DIR="$SCRIPT_DIR/job_agent/data"
mkdir -p "$DATA_DIR"
echo -e "  ${GREEN}[OK] Data directory exists: $DATA_DIR${NC}"

ENV_FILE="$SCRIPT_DIR/job_agent/.env"
ENV_EXAMPLE="$SCRIPT_DIR/job_agent/.env.example"
if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo -e "  ${GREEN}[OK] Created 'job_agent/.env' from template.${NC}"
else
    echo -e "  ${GREEN}[OK] 'job_agent/.env' already present.${NC}"
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
echo -e "  1. Add your AI API key:"
echo -e "     Edit 'job_agent/.env' and provide your BROWSER_USE_API_KEY or OPENAI_API_KEY."
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
