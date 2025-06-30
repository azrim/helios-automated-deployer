const fs = require("fs");
const path = require("path");

const logFile = path.join(__dirname, "../../deployments.json");

/**
 * Loads the deployment log from deployments.json.
 * If the file doesn't exist, it creates it with an empty array.
 * @returns {Array} An array of deployment log entries.
 */
function loadLog() {
    try {
        if (!fs.existsSync(logFile)) {
            // Initialize with an empty array for the new structure
            fs.writeFileSync(logFile, JSON.stringify([], null, 2));
            return [];
        }
        const fileContent = fs.readFileSync(logFile, "utf-8");
        // Ensure we parse to an array, defaulting to one if the file is empty or malformed
        const data = fileContent ? JSON.parse(fileContent) : [];
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("❌ Error loading or parsing deployments.json, starting with a fresh log.", error);
        // If parsing fails, start with a fresh array
        fs.writeFileSync(logFile, JSON.stringify([], null, 2));
        return [];
    }
}

/**
 * Saves the deployment log data to deployments.json.
 * @param {Array} data - The array of deployment log entries to save.
 */
function saveLog(data) {
    try {
        const replacer = (key, value) =>
            typeof value === 'bigint' ? value.toString() : value;
        fs.writeFileSync(logFile, JSON.stringify(data, replacer, 2));
    } catch (error) {
        console.error("❌ Error writing to deployments.json:", error);
    }
}

/**
 * Logs the details of a deployment by appending it to deployments.json.
 * @param {string} name - The unique key for the log entry (e.g., "MyToken", "FeeCollector").
 * @param {object} deploymentData - The pre-constructed object containing deployment info.
 * @param {object} tx - The full transaction object from ethers.js.
 * @param {object} hre - The Hardhat Runtime Environment.
 */
async function logDeployment(name, deploymentData, tx, hre) {
    const logEntries = loadLog();

    try {
        const receipt = await tx.wait();
        const block = await hre.ethers.provider.getBlock(receipt.blockNumber);

        // Add transaction and block details to the deployment data
        deploymentData.tx = tx.hash;
        deploymentData.explorer = `https://explorer.helioschainlabs.org/tx/${tx.hash}`;
        deploymentData.blockNumber = receipt.blockNumber;
        deploymentData.timestamp = new Date(block.timestamp * 1000).toISOString();
        deploymentData.key = name; // Add the contract key to the object itself

    } catch (error) {
        console.warn(`⚠️ Could not get receipt for tx ${tx.hash}. It may have failed.`);
        deploymentData.blockNumber = "N/A (pending or failed)";
        deploymentData.timestamp = new Date().toISOString();
        deploymentData.key = name;
    }

    // Push the new deployment data as a new entry into the array
    logEntries.push(deploymentData);

    saveLog(logEntries);
    console.log(`📝 Appended '${name}' to deployments.json`);
}

module.exports = { logDeployment };