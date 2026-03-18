# PolyFront MEV Bot (Client)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Proprietary-blue.svg)](LICENSE)

Automated trading client for Polymarket on Polygon.  
Monitors the Polymarket API and Polygon mempool in real-time to detect and act on market opportunities with low-latency execution.

**Client is open-source for audit and transparency.**  
You can review the full source code yourself.  
**Private keys never leave your machine. No server-side execution.**

## Requirements

- **Node.js** v14 or higher — [download here](https://nodejs.org/)
- **License key** — [purchase on the website](https://polyfront.bet/)
- A Polygon wallet with **USDC** (for trading) and **POL** (for gas)

## Installation

### 1. Download the bot

Click the green **"Code"** button → **"Download ZIP"**. Extract to any folder.

Or with git:

```bash
git clone https://github.com/polyfrontlabs/polyfrontbot-client.git
cd polyfrontbot-client
```

### 2. Install dependencies

**Windows (quick):** double-click **`install-windows.bat`** - it will check Node.js and install everything automatically.

**Windows / macOS / Linux (terminal):**

```bash
npm install
```

---

## Configuration

1. Rename the file **`.env.example`** to **`.env`** (just remove the `.example` part).

Or use a terminal command:

**macOS / Linux:**
```bash
cp .env.example .env
```

**Windows (CMD):**
```cmd
copy .env.example .env
```

2. Open `.env` and paste your wallet private key:


> **Security:** never share your `.env` file or private key with anyone.

---

## Usage

### Windows (quick)

Double-click **`start-windows.bat`**.

### Windows / macOS / Linux (terminal)

```bash
npm start
```

On first launch the bot will ask for your license key. After activation you will see the main menu with available modules.

---

## Free Trial

Want to try before you buy? A free trial license is available:

- **Website:** [polyfront.bet](https://polyfront.bet/) - click **"Get Trial"** on any plan
- **Telegram:** [@PolyFrontBot](https://t.me/PolyFrontBot) - request a trial key directly from the bot

---

## Features

- **MEV front-running** - detects large market orders and captures the spread
- **Copy trading** (free bonus) - mirror trades from profitable wallets in real-time
- **HWID-locked license** - one activation per machine, secure and non-transferable
- **Fully open-source client** - audit the code yourself

---

## Links

| | |
|---|---|
| **Website & Buy license** | [polyfront.bet](https://polyfront.bet/) |
| **Support Telegram** | [@PolyFrontBot](https://t.me/PolyFrontBot) |

---

## License

Proprietary / Commercial.
This repository contains the client code only.
Usage requires a valid license key from https://polyfront.bet.
See full terms there.
