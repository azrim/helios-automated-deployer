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

async function main() {
    console.log("🔍 Preparing files for Standard-JSON-Input contract verification...");

    const deploymentsPath = path.join(__dirname, '../deployments.json');
    if (!fs.existsSync(deploymentsPath)) {
        console.error("❌ deployments.json not found! Please deploy a contract first.");
        return;
    }

    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    if (!Array.isArray(deployments) || deployments.length === 0) {
        console.error("❌ No deployments found in deployments.json or the file is in an old format.");
        return;
    }

    // Display the most recent deployments first for convenience
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

    // Select the correct deployment from the reversed list
    const deploymentData = reversedDeployments[choice];
    const originalLogName = deploymentData.logName;
    const selectedContractKey = deploymentData.key;

    if (!originalLogName) {
        console.error(`❌ The selected deployment for "${selectedContractKey}" does not contain the required metadata. Please clear deployments and redeploy it.`);
        return;
    }

    console.log(`\n✅ Selected: ${selectedContractKey} (Original logName: ${originalLogName})`);

    try {
        const templateConfigPath = path.join(__dirname, '../deployment-config-template.json');
        const templateConfig = JSON.parse(fs.readFileSync(templateConfigPath, 'utf-8'));
        const contractConfig = templateConfig.contracts.find(c => c.logName === originalLogName);

        if (!contractConfig) {
             throw new Error(`Contract config for logName "${originalLogName}" not found in template.`);
        }

        const contractName = contractConfig.name;
        const { address: contractAddress, constructorArgs: resolvedArgs } = deploymentData;

        if (!resolvedArgs) {
             throw new Error(`Constructor arguments not found for "${selectedContractKey}" in deployments.json. Please clear deployments and redeploy.`);
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
            if (buildInfo.input) {
                if (Object.keys(buildInfo.input.sources).some(sourcePath => sourcePath.includes(`/${contractName}.sol`))) {
                    standardJsonInput = buildInfo.input;
                    break;
                }
            }
        }

        if (!standardJsonInput) {
            throw new Error(`Could not find Standard JSON Input for ${contractName}. Please recompile your contracts.`);
        }

        const solcConfig = hre.config.solidity.compilers[0];
        const compilerVersion = `v${solcConfig.version}`;

        let abiEncodedConstructorArguments = "0x";
        if (constructorArgTypes.length > 0) {
            abiEncodedConstructorArguments = hre.ethers.utils.defaultAbiCoder.encode(constructorArgTypes, resolvedArgs).slice(2);
        }

        const verificationInfo = {
            contractAddress: contractAddress,
            compilerVersion: compilerVersion,
            abiEncodedConstructorArguments: abiEncodedConstructorArguments
        };

        const verificationDir = path.join(__dirname, '../verification');
        if (!fs.existsSync(verificationDir)) fs.mkdirSync(verificationDir);

        const standardInputFileName = `${selectedContractKey}_standard_input.json`.replace(/ /g, "_");
        const argsFileName = `${selectedContractKey}_args.json`.replace(/ /g, "_");

        fs.writeFileSync(path.join(verificationDir, standardInputFileName), JSON.stringify(standardJsonInput, null, 2));
        fs.writeFileSync(path.join(verificationDir, argsFileName), JSON.stringify(verificationInfo, null, 2));

        console.log("\n🎉 Verification files prepared successfully!");
        console.log(`   Your files are located in the \`verification/\` directory:`);
        console.log(`   - Standard JSON Input: ${standardInputFileName}`);
        console.log(`   - Arguments Info:      ${argsFileName}`);

        const explorerUrl = `https://explorer.helioschainlabs.org/address/${contractAddress}`;
        console.log("\nNext steps for Helios Explorer:");
        console.log(`1. Go to your contract on the explorer: ${explorerUrl}`);
        console.log("2. Click the 'Contract' tab, then 'Verify & Publish'.");
        console.log("3. Select Compiler Type: 'Solidity (Standard-Json-Input)'.");
        console.log(`4. Select Compiler Version: ${compilerVersion}`);
        console.log(`5. Upload the Standard-JSON-Input file: \`verification/${standardInputFileName}\``);
        console.log("6. If prompted for constructor arguments, copy the encoded string from `verification/" + argsFileName + "`.");

    } catch (error) {
        console.error(`\n❌ An error occurred: ${error.message}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});