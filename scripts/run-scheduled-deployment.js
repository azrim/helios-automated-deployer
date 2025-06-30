const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKFLOW_LOG_PATH = path.join(__dirname, '../workflow.json');
const LOCAL_DEPLOYMENT_LOG_PATH = path.join(__dirname, '../deployments.json');
const CONFIG_PATH = path.join(__dirname, '../deployment-config-template.json');

// --- Configuration ---
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const CHRONOS_ENABLED_CONTRACTS = config.contracts
    .filter(c => c.interactions && c.interactions.some(i => i.type === 'chronos'))
    .map(c => c.logName);

const ALL_CONTRACT_LOG_NAMES = config.contracts.map(c => c.logName);

const LOG_RETENTION_HOURS = 48;
const CHRONOS_MANDATORY_INTERVAL_HOURS = 12;

/**
 * Removes log entries from workflow.json that are older than the retention period.
 */
function cleanupOldDeployments() {
    if (!fs.existsSync(WORKFLOW_LOG_PATH)) return;
    console.log(`\n🧹 Cleaning deployment logs older than ${LOG_RETENTION_HOURS} hours...`);

    const deployments = getFullDeploymentLog();
    const now = new Date();
    const retentionPeriod = new Date(now.getTime() - (LOG_RETENTION_HOURS * 60 * 60 * 1000));

    const recentDeployments = deployments.filter(dep => {
        return dep.timestamp && new Date(dep.timestamp) > retentionPeriod;
    });

    const cleanedCount = deployments.length - recentDeployments.length;

    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(recentDeployments, null, 2));

    if (cleanedCount > 0) {
        console.log(`   -> Removed ${cleanedCount} old deployment records.`);
    } else {
        console.log(`   -> No old records to remove.`);
    }
}

/**
 * Executes a shell command and streams its output.
 * @param {string} command The command to execute.
 * @returns {Promise<void>} A promise that resolves when the command completes.
 */
function executeCommand(command) {
    return new Promise((resolve, reject) => {
        console.log(`\n> Executing: ${command}\n`);
        const childProcess = exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return reject(new Error(`Command failed with exit code ${error.code}`));
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
            }
            console.log(`stdout: ${stdout}`);
            resolve();
        });

        childProcess.stdout.pipe(process.stdout);
        childProcess.stderr.pipe(process.stderr);
    });
}

/**
 * Reads and parses the workflow.json log file.
 * @returns {Array<object>} An array of deployment objects.
 */
function getFullDeploymentLog() {
    if (!fs.existsSync(WORKFLOW_LOG_PATH)) {
        console.log(`Workflow log not found. Starting fresh.`);
        return [];
    }
    try {
        const data = JSON.parse(fs.readFileSync(WORKFLOW_LOG_PATH, 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("Error reading or parsing workflow.json, returning empty log.", e);
        return [];
    }
}

/**
 * Determines which contract to deploy next based on deployment history.
 * @returns {string} The logName of the contract to deploy.
 */
function getNextContractToDeploy() {
    const allDeployments = getFullDeploymentLog();
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - (CHRONOS_MANDATORY_INTERVAL_HOURS * 60 * 60 * 1000));

    // Find the timestamp of the most recent Chronos deployment by reducing the array
    const lastChronosDeployment = allDeployments
        .filter(dep => CHRONOS_ENABLED_CONTRACTS.includes(dep.logName) && dep.timestamp)
        .reduce((latest, current) => {
            const latestTime = new Date(latest.timestamp);
            const currentTime = new Date(current.timestamp);
            return currentTime > latestTime ? current : latest;
        }, { timestamp: '1970-01-01T00:00:00.000Z' }); // Initial old value

    const lastChronosDeploymentTime = new Date(lastChronosDeployment.timestamp);

    console.log(`\nLast Chronos-type deployment was at: ${lastChronosDeploymentTime.toLocaleString()}`);
    console.log(`12 hours ago was: ${twelveHoursAgo.toLocaleString()}`);

    // 1. Check if it's been more than 12 hours since the last Chronos deployment
    if (lastChronosDeploymentTime < twelveHoursAgo) {
        console.log(`   -> It has been more than ${CHRONOS_MANDATORY_INTERVAL_HOURS} hours. A Chronos deployment is mandatory.`);
        const chronosContractToDeploy = CHRONOS_ENABLED_CONTRACTS[Math.floor(Math.random() * CHRONOS_ENABLED_CONTRACTS.length)];
        console.log(`   -> Decision: Deploying mandatory Chronos contract: ${chronosContractToDeploy}`);
        return chronosContractToDeploy;
    }

    // 2. If the Chronos requirement is met, deploy a random contract from the full list
    console.log(`   -> Chronos requirement is met. Deploying a random contract.`);
    const randomLogName = ALL_CONTRACT_LOG_NAMES[Math.floor(Math.random() * ALL_CONTRACT_LOG_NAMES.length)];
    console.log(`   -> Decision: ${randomLogName}`);
    return randomLogName;
}

/**
 * Appends the new deployment from deployments.json to workflow.json.
 */
function updateWorkflowLog() {
    if (!fs.existsSync(LOCAL_DEPLOYMENT_LOG_PATH)) return;

    // The local log (deployments.json) is now also an array.
    const newDeployments = JSON.parse(fs.readFileSync(LOCAL_DEPLOYMENT_LOG_PATH, 'utf-8'));
    if (!Array.isArray(newDeployments) || newDeployments.length === 0) {
        console.log("No new deployments found in deployments.json to update the workflow log.");
        return;
    }
    
    let workflowLog = getFullDeploymentLog();

    // Concatenate the arrays to append new deployments
    const updatedLog = workflowLog.concat(newDeployments);

    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(updatedLog, null, 2));
    console.log(`📝 Appended ${newDeployments.length} new deployment(s) to workflow.json`);

    // Clear the local deployments log so it's fresh for the next run
    fs.writeFileSync(LOCAL_DEPLOYMENT_LOG_PATH, JSON.stringify([], null, 2));
    console.log(`   -> Cleared local deployments.json for next run.`);
}

async function main() {
    try {
        cleanupOldDeployments();

        const logNameToDeploy = getNextContractToDeploy();
        if (!logNameToDeploy) {
            console.log("No contract to deploy at this time.");
            return;
        }

        const command = `npx hardhat deploy --log-name ${logNameToDeploy} --network heliosTestnet`;
        await executeCommand(command);

        updateWorkflowLog();

        console.log(`\n✅ Successfully completed deployment for ${logNameToDeploy}.`);

    } catch (error) {
        console.error('\n❌ An error occurred during the scheduled deployment:', error);
        process.exit(1);
    }
}

main();