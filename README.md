# Helios Automated Deployer & Interaction Suite

![Visitor Count](https://api.visitorbadge.io/api/VisitorHit?user=azrim&repo=helios-deployer)
[![Scheduled Helios Deployment](https://github.com/azrim/helios-automated-deployer/actions/workflows/deploy.yml/badge.svg)](https://github.com/azrim/helios-automated-deployer/actions/workflows/deploy.yml)

This repository provides a powerful and flexible suite of tools for deploying and interacting with smart contracts on the **Helios Network**. It leverages a configuration-driven approach and custom Hardhat tasks to automate the deployment of multiple contracts, including ERC20 tokens, ERC721 NFTs, and contracts that integrate with Helios's native AI, Chronos (cron job), and Hyperion (oracle) precompiles.

The system is designed for a reliable and efficient development workflow, featuring automated compilation, selective deployments, detailed logging, and a streamlined contract verification helper.

## 🚀 Key Features

* **Automated, Task-Driven Deployment**: Deploy an entire suite of contracts or a single contract with a single, simple command using custom Hardhat tasks.
* **Automatic Compilation**: The deployment tasks automatically compile your contracts first, ensuring artifacts are always up-to-date.
* **Selective Deployment**: Choose to deploy all contracts at once or target a single contract using its `logName` for quick updates and testing.
* **Automated Contract Verification**: A helper script that prepares all the necessary files for contract verification on the block explorer using the "Standard-JSON-Input" method.
* **Precompile Integration**: Includes example contracts and scripts for interacting with Helios's powerful precompiles:
    * **AIAgent**: An on-chain agent that calls the AI precompile.
    * **HyperionQuery**: A robust wrapper for making both structured and raw queries to the Hyperion cross-chain oracle.
    * **Chronos Integration**: Schedule recurring tasks (cron jobs) for contracts like `FeeCollector`, `DailyReporter`, `AutonomousMint`, and the new `Heartbeat` contract.
* **Detailed Logging**: All deployments are automatically saved to `deployments.json`, including constructor arguments and other metadata required for verification.
* **Advanced Cleanup Utility**: A powerful cleanup script to selectively delete logs, verification files, the Hardhat cache, or even the entire `node_modules` directory for a completely fresh start.

## 🛠️ Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/azrim/helios-deployer.git
cd helios-deployer
```

### 2. Install Dependencies

This project uses `npm` to manage its dependencies. To install them, run:

```bash
npm install
```

### 3. Configure Your Environment

Create a `.env` file in the root of the project. Add your wallet's private key and the official Helios Testnet RPC URL.

```env
# .env
PRIVATE_KEY=your_wallet_private_key_here
RPC_URL=https://testnet1.helioschainlabs.org
```

> **Security Warning**: The `.env` file is included in `.gitignore` for safety. **Never commit this file or share your private key.** Use a dedicated development wallet with testnet funds only.

## ⚙️ Core Concept: The Deployment Config

The heart of this system is the `deployment-config-template.json` file. The deployment script uses this template to generate a new randomized `deployment-config.json` for each run.

* **`name`**: The name of the contract to deploy (e.g., `MyToken`).
* **`args`**: An array of constructor arguments for the contract. You can use `"deployerWallet"` or `"treasuryWallet"` as placeholders.
* **`logName`**: A static, unique identifier used for targeted deployments and logging.
* **`interactions`**: An array of post-deployment actions to perform, such as `mint`, `call`, or scheduling a `chronos` job.

## USAGE

### Automated Deployment

The deployment script has been refactored into a robust Hardhat task, allowing for clean and cross-platform commands.

#### Deploying All Contracts

This command automatically compiles all contracts and then deploys every contract listed in the configuration.

```bash
npm run deploy
```

#### Selective Deployment

To save time, you can deploy and interact with just one contract by using its specific `npm` script. This calls the `deploy` task and passes the contract's `logName` as a parameter.

* **Deploy only the Token**:
    ```bash
    npm run deploy:token
    ```
* **Deploy only the NFT** (and mints tokens):
    ```bash
    npm run deploy:nft
    ```
* **Deploy other contracts**:
    ```bash
    npm run deploy:agent
    npm run deploy:fee
    npm run deploy:reporter
    npm run deploy:hyperion
    npm run deploy:heartbeat
    ```

### Contract Verification

After deploying a contract, you can easily prepare the files needed for verification on the block explorer.

1.  **Run the verification helper**:
    ```bash
    npm run verify:prepare
    ```
2.  **Choose the contract** you want to verify from the list of your recent deployments.
3.  The script will create a `verification/` directory containing the `Standard-JSON-Input` file and an `_args.json` file with the constructor arguments.
4.  Follow the instructions printed in the terminal to complete the verification process on the Helios Explorer.

### Environment Cleanup

A powerful, interactive script is available to clean your local development environment.

```bash
npm run cleanup
```

You will be prompted with several options, including clearing logs, deleting the Hardhat cache, and even removing the `node_modules` directory for a complete reset.

## 📁 Project Structure

```
helios-deployer/
│
├── contracts/
│   ├── AIAgent.sol
│   ├── AutonomousMint.sol
│   ├── DailyReporter.sol
│   ├── FeeCollector.sol
│   ├── Heartbeat.sol
│   ├── HyperionQuery.sol
│   ├── MyNFT.sol
│   └── MyToken.sol
│
├── scripts/
│   ├── cleanup-environment.js
│   ├── deploy.js
│   ├── prepare-verification.js
│   └── utils/
│       └── logger.js
│
├── verification/
│
├── .env
├── deployment-config-template.json
├── deployments.json
├── hardhat.config.js
├── package.json
└── README.md
```

## 🪪 License

This project is licensed under the MIT License.
