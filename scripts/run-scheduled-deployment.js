const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKFLOW_LOG_PATH = path.join(__dirname, '../workflow.json');
const CONFIG_PATH = path.join(__dirname, '../deployment-config-template.json');

// --- Configuration ---
// Read the config to dynamically find which contracts are 'chronos' type
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const CHRONOS_ENABLED_CONTRACTS = config.contracts
    .filter(c => c.interactions && c.interactions.some(i => i.type === 'chronos'))
    .map(c => c.logName);

const ALL_CONTRACT_LOG_NAMES = config.contracts.map(c => c.logName);

const LOG_RETENTION_HOURS = 48; // Keep 48 hours of history
const CHRONOS_MANDATORY_INTERVAL_HOURS = 12; // Deploy a chronos task if the last one was > 12 hours ago

function cleanupOldDeployments() {
    if (!fs.existsSync(WORKFLOW_LOG_PATH)) return;
    console.log(`\n🧹 Cleaning deployment logs older than ${LOG_RETENTION_HOURS} hours...`);
    
    const deployments = JSON.parse(fs.readFileSync(WORKFLOW_LOG_PATH, 'utf-8'));
    const now = new Date();
    const retentionPeriod = new Date(now.getTime() - (LOG_RETENTION_HOURS * 60 * 60 * 1000));
    
    const recentDeployments = {};
    let cleanedCount = 0;

    for (const key in deployments) {
        const dep = deployments[key];
        if (dep.timestamp && new Date(dep.timestamp) > retentionPeriod) {
            recentDeployments[key] = dep;
        } else {
            cleanedCount++;
        }
    }

    const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(recentDeployments, replacer, 2));

    if (cleanedCount > 0) {
        console.log(`   -> Removed ${cleanedCount} old deployment records.`);
    } else {
        console.log(`   -> No old records to remove.`);
    }
}

function executeCommand(command) {
    return new Promise((resolve, reject) => {
        console.log(`\n> Executing: ${command}\n`);
        const childProcess = exec(command);
        childProcess.stdout.pipe(process.stdout);
        childProcess.stderr.pipe(process.stderr);
        childProcess.on('close', (code) => {
            if (code !== 0) reject(new Error(`Command failed with exit code ${code}`));
            else resolve();
        });
    });
}

function getFullDeploymentLog() {
    if (!fs.existsSync(WORKFLOW_LOG_PATH)) {
        console.log(`Workflow log not found. Starting fresh.`);
        return {};
    }
    return JSON.parse(fs.readFileSync(WORKFLOW_LOG_PATH, 'utf-8'));
}

function getNextContractToDeploy() {
    const allDeployments = getFullDeploymentLog();
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - (CHRONOS_MANDATORY_INTERVAL_HOURS * 60 * 60 * 1000));

    // Find the timestamp of the most recent Chronos deployment
    let lastChronosDeploymentTime = new Date(0); // Initialize to a very old date
    for (const key in allDeployments) {
        const dep = allDeployments[key];
        if (dep.timestamp && CHRONOS_ENABLED_CONTRACTS.includes(dep.logName)) {
            const depTime = new Date(dep.timestamp);
            if (depTime > lastChronosDeploymentTime) {
                lastChronosDeploymentTime = depTime;
            }
        }
    }
    
    console.log(`\nLast Chronos-type deployment was at: ${lastChronosDeploymentTime.toLocaleString()}`);
    console.log(`12 hours ago was: ${twelveHoursAgo.toLocaleString()}`);

    // ** NEW LOGIC **
    // 1. Check if it's been more than 12 hours since the last Chronos deployment
    if (lastChronosDeploymentTime < twelveHoursAgo) {
        console.log(`   -> It has been more than 12 hours. A Chronos deployment is mandatory.`);
        // Pick a random contract from the list of Chronos-enabled contracts
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

function updateWorkflowLog() {
    const localLogPath = path.join(__dirname, '../deployments.json');
    if (!fs.existsSync(localLogPath)) return;

    const localLog = JSON.parse(fs.readFileSync(localLogPath, 'utf-8'));
    let workflowLog = getFullDeploymentLog();
    
    Object.assign(workflowLog, localLog);

    const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(workflowLog, replacer, 2));
    console.log(`📝 Saved deployment data to workflow.json`);
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
        console.error('\n❌ An error occurred during the scheduled deployment:', error.message);
        process.exit(1);
    }
}

main();