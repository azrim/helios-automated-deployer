const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Helper function for asking command-line questions
function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) =>
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        })
    );
}

/**
 * Generates the standard-json-input and argument files for a given deployment.
 * @param {object} deploymentData - The deployment object from the log.
 * @returns {Promise<{standardInputPath: string, argsPath: string}>} Paths to the generated files.
 */
async function generateVerificationFiles(deploymentData) {
    const originalLogName = deploymentData.logName;
    const selectedContractKey = deploymentData.key;

    if (!originalLogName) {
        throw new Error(`The selected deployment for "${selectedContractKey}" does not contain the required metadata.`);
    }

    console.log(`\n✅ Preparing verification for: ${selectedContractKey} (Original logName: ${originalLogName})`);

    const templateConfigPath = path.join(__dirname, '../deployment-config-template.json');
    const templateConfig = JSON.parse(fs.readFileSync(templateConfigPath, 'utf-8'));
    const contractConfig = templateConfig.contracts.find(c => c.logName === originalLogName);

    if (!contractConfig) {
        throw new Error(`Contract config for logName "${originalLogName}" not found in template.`);
    }

    const contractName = contractConfig.name;
    const { address: contractAddress, constructorArgs: resolvedArgs } = deploymentData;

    if (!resolvedArgs) {
        throw new Error(`Constructor arguments not found for "${selectedContractKey}" in deployments.json.`);
    }

    const artifact = await hre.artifacts.readArtifact(contractName);
    const constructorInputs = artifact.abi.find(item => item.type === "constructor")?.inputs || [];
    const constructorArgTypes = constructorInputs.map(input => input.type);

    console.log(`\n... Locating build info for ${contractName}...`);
    const buildInfoPath = path.join(hre.config.paths.artifacts, 'build-info');
    const buildInfoFiles = fs.readdirSync(buildInfoPath);

    let standardJsonInput;
    for (const file of buildInfoFiles) {
        const buildInfo = JSON.parse(fs.readFileSync(path.join(buildInfoPath, file), 'utf8'));
        if (buildInfo.input && Object.keys(buildInfo.input.sources).some(sourcePath => sourcePath.includes(`/${contractName}.sol`))) {
            standardJsonInput = buildInfo.input;
            break;
        }
    }

    if (!standardJsonInput) {
        throw new Error(`Could not find Standard JSON Input for ${contractName}. Please recompile your contracts.`);
    }

    const solcConfig = hre.config.solidity.compilers[0];
    const compilerVersion = `v${solcConfig.version}`;
    const abiEncodedConstructorArguments = constructorArgTypes.length > 0
        ? hre.ethers.utils.defaultAbiCoder.encode(constructorArgTypes, resolvedArgs).slice(2)
        : "0x";

    const verificationInfo = {
        contractAddress,
        compilerVersion,
        abiEncodedConstructorArguments,
    };

    const verificationDir = path.join(__dirname, '../verification');
    if (!fs.existsSync(verificationDir)) fs.mkdirSync(verificationDir);

    const safeKey = selectedContractKey.replace(/ /g, "_");
    const standardInputFileName = `${safeKey}_standard_input.json`;
    const argsFileName = `${safeKey}_args.json`;
    
    const standardInputPath = path.join(verificationDir, standardInputFileName);
    const argsPath = path.join(verificationDir, argsFileName);

    fs.writeFileSync(standardInputPath, JSON.stringify(standardJsonInput, null, 2));
    fs.writeFileSync(argsPath, JSON.stringify(verificationInfo, null, 2));

    console.log("\n🎉 Verification files prepared successfully!");
    console.log(`   - Standard JSON Input: ${standardInputFileName}`);
    console.log(`   - Arguments Info:      ${argsFileName}`);
    
    return { standardInputPath, argsPath };
}


async function main() {
    console.log("🔍 Preparing files for Standard-JSON-Input contract verification...");
    const deploymentsPath = path.join(__dirname, '../deployments.json');
    if (!fs.existsSync(deploymentsPath)) {
        console.error("❌ deployments.json not found! Please deploy a contract first.");
        return;
    }
    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    if (!Array.isArray(deployments) || deployments.length === 0) {
        console.error("❌ No deployments found in deployments.json.");
        return;
    }

    const reversedDeployments = [...deployments].reverse();
    const availableContracts = reversedDeployments.map((dep, i) =>
        `  ${i}: ${dep.key} (${dep.address}) deployed at ${new Date(dep.timestamp).toLocaleString()}`
    ).join('\n');

    const choiceIndexStr = await ask(`\nWhich contract do you want to verify?\n(Most recent are listed first)\n${availableContracts}\n\nEnter number: `);
    const choice = parseInt(choiceIndexStr, 10);

    if (isNaN(choice) || choice < 0 || choice >= reversedDeployments.length) {
        console.error("❌ Invalid selection.");
        return;
    }

    const deploymentData = reversedDeployments[choice];
    
    try {
        await generateVerificationFiles(deploymentData);
        
        const explorerUrl = `https://explorer.helioschainlabs.org/address/${deploymentData.address}`;
        console.log("\nNext steps for Helios Explorer:");
        console.log(`1. Go to your contract on the explorer: ${explorerUrl}`);
        console.log("2. Click the 'Contract' tab, then 'Verify & Publish'.");
        console.log("3. ... (Follow instructions printed above)");

    } catch (error) {
        console.error(`\n❌ An error occurred: ${error.message}`);
        process.exit(1);
    }
}

// Export the core logic for other scripts to use
module.exports = { generateVerificationFiles };

// Allow running the script directly for interactive use
if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}